import os
from datetime import datetime, timedelta, timezone
from typing import Annotated, Union, List, Optional
import pymongo
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field
import pytz

# --- Configuration ---
load_dotenv()
MONGO_DETAILS = os.getenv("MONGO_DETAILS")
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_MINUTES = 3000

# --- FastAPI App Initialization ---
app = FastAPI()

# --- CORS Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://elaborate-stardust-1b713c.netlify.app/", "https://schedule-match-production.up.railway.app/"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database Connection ---
try:
    client = pymongo.MongoClient(MONGO_DETAILS)
    db = client.userdatabase 
    user_collection = db.get_collection("users")
    schedule_collection = db.get_collection("schedules")
    match_collection = db.get_collection("matches")

    user_collection.create_index("username", unique=True)
    schedule_collection.create_index([("username", 1), ("date", 1)], unique=True)
    match_collection.create_index([("users", 1)], unique=True)

    print("Successfully connected to MongoDB.")
except Exception as e:
    print(f"Error connecting to MongoDB: {e}")
    client = None

# --- Security ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- Pydantic Models ---
class TimeSlot(BaseModel):
    start: str
    end: str

class DaySchedule(BaseModel):
    date: str
    busy_times: List[TimeSlot] = []
    free_times: List[TimeSlot] = []
    is_available: bool = True

class ScheduleUpdate(BaseModel):
    date: str
    busy_times: List[TimeSlot] = []
    free_times: List[TimeSlot] = []
    is_available: bool = True

class User(BaseModel):
    username: str
    display_name: str
    timezone: Optional[str] = "UTC"
    friends: List[str] = []
    friend_requests: List[str] = []
    match_requests: List[str] = []

class UserInDB(User):
    hashed_password: str

class UserCreate(BaseModel):
    username: str
    display_name: str
    password: str

class UserProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    timezone: Optional[str] = None

class UserSearchResult(BaseModel):
    username: str
    display_name: str
    friendship_status: str

class FriendRequest(BaseModel):
    to_username: str

class FriendRequestResponse(BaseModel):
    from_username: str
    accept: bool

class ScheduleMatch(BaseModel):
    match_id: str
    users: List[str]
    status: str
    requested_by: str

class OverlapResult(BaseModel):
    date: str
    overlaps: List[TimeSlot]
    user_a_slots: List[TimeSlot]
    user_b_slots: List[TimeSlot]

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Union[str, None] = None

# --- Helper Functions ---
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Union[timedelta, None] = None):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def merge_intervals(intervals: List[tuple]) -> List[tuple]:
    if not intervals:
        return []

    # Sort intervals by their start time
    intervals.sort(key=lambda x: x[0])

    merged = [intervals[0]]
    for current_start, current_end in intervals[1:]:
        last_start, last_end = merged[-1]
        
        # If the current interval overlaps with or is adjacent to the last one, merge them
        if current_start <= last_end:
            merged[-1] = (last_start, max(last_end, current_end))
        else:
            merged.append((current_start, current_end))
            
    return merged

def calculate_overlaps(date_str: str, user_a: User, user_b: User) -> tuple:
    schedule_a = schedule_collection.find_one({"username": user_a.username, "date": date_str})
    schedule_b = schedule_collection.find_one({"username": user_b.username, "date": date_str})

    if not schedule_a or not schedule_b or not schedule_a.get("is_available") or not schedule_b.get("is_available"):
        return [], [], []

    tz_a = pytz.timezone(user_a.timezone or 'UTC')
    tz_b = pytz.timezone(user_b.timezone or 'UTC')

    # Convert free times to UTC datetime objects
    utc_slots_a = []
    for slot in schedule_a.get("free_times", []):
        try:
            start_dt = datetime.fromisoformat(f"{date_str}T{slot['start']}")
            end_dt = datetime.fromisoformat(f"{date_str}T{slot['end']}")
            utc_slots_a.append((tz_a.localize(start_dt).astimezone(pytz.utc), tz_a.localize(end_dt).astimezone(pytz.utc)))
        except (ValueError, TypeError): continue

    utc_slots_b = []
    for slot in schedule_b.get("free_times", []):
        try:
            start_dt = datetime.fromisoformat(f"{date_str}T{slot['start']}")
            end_dt = datetime.fromisoformat(f"{date_str}T{slot['end']}")
            utc_slots_b.append((tz_b.localize(start_dt).astimezone(pytz.utc), tz_b.localize(end_dt).astimezone(pytz.utc)))
        except (ValueError, TypeError): continue

    # Find raw overlaps in UTC
    raw_overlaps_utc = []
    for start_a, end_a in utc_slots_a:
        for start_b, end_b in utc_slots_b:
            overlap_start = max(start_a, start_b)
            overlap_end = min(end_a, end_b)
            if overlap_start < overlap_end:
                raw_overlaps_utc.append((overlap_start, overlap_end))

    # *** FIX: Merge the overlapping intervals ***
    merged_overlaps_utc = merge_intervals(raw_overlaps_utc)
    
    # Also merge the individual lists for cleaner display
    merged_slots_a_utc = merge_intervals(utc_slots_a)
    merged_slots_b_utc = merge_intervals(utc_slots_b)

    # Convert results back to User B's timezone (the requesting user)
    final_overlaps = [TimeSlot(start=o[0].astimezone(tz_b).strftime('%H:%M'), end=o[1].astimezone(tz_b).strftime('%H:%M')) for o in merged_overlaps_utc]
    user_a_converted_slots = [TimeSlot(start=s[0].astimezone(tz_b).strftime('%H:%M'), end=s[1].astimezone(tz_b).strftime('%H:%M')) for s in merged_slots_a_utc]
    user_b_final_slots = [TimeSlot(start=s[0].astimezone(tz_b).strftime('%H:%M'), end=s[1].astimezone(tz_b).strftime('%H:%M')) for s in merged_slots_b_utc]
    
    return final_overlaps, user_a_converted_slots, user_b_final_slots

# --- Dependencies ---
async def get_current_user_from_db(username: str):
    if user := user_collection.find_one({"username": username}):
        return User(**user)
    return None

async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]):
    credentials_exception = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if (username := payload.get("sub")) is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    if (user := await get_current_user_from_db(username)) is None:
        raise credentials_exception
    return user

# --- API Endpoints ---
@app.get("/")
def read_root(): return {"Status": "API is running"}

# ... Other endpoints ...
@app.post("/register", status_code=status.HTTP_201_CREATED)
def register_user(user: UserCreate):
    if user_collection.find_one({"username": user.username}):
        raise HTTPException(status_code=400, detail="Username already registered")
    
    user_data = user.dict()
    user_data["hashed_password"] = get_password_hash(user.password)
    user_data["timezone"] = "UTC"
    user_data["friends"] = []
    user_data["friend_requests"] = []
    user_data["match_requests"] = []
    del user_data["password"]
    user_collection.insert_one(user_data)
    
    return {"message": "User registered successfully"}

@app.post("/token", response_model=Token)
async def login_for_access_token(form_data: Annotated[OAuth2PasswordRequestForm, Depends()]):
    user = user_collection.find_one({"username": form_data.username})
    if not user or not verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password", headers={"WWW-Authenticate": "Bearer"})
    
    expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    token = create_access_token(data={"sub": user["username"]}, expires_delta=expires)
    return {"access_token": token, "token_type": "bearer"}

@app.get("/users/me/", response_model=User)
async def read_users_me(current_user: Annotated[User, Depends(get_current_user)]):
    return current_user

@app.put("/users/me/", response_model=User)
async def update_user_profile(profile_update: UserProfileUpdate, current_user: Annotated[User, Depends(get_current_user)]):
    if not (update_data := profile_update.dict(exclude_unset=True)):
        return current_user
    
    user_collection.update_one({"username": current_user.username}, {"$set": update_data})
    return await get_current_user_from_db(current_user.username)

# ... Schedule Endpoints ...
@app.post("/schedule/", status_code=status.HTTP_201_CREATED)
async def update_schedule(schedule_data: ScheduleUpdate, current_user: Annotated[User, Depends(get_current_user)]):
    schedule_doc = schedule_data.dict()
    schedule_doc["username"] = current_user.username
    schedule_doc["updated_at"] = datetime.now(timezone.utc)
    schedule_collection.replace_one({"username": current_user.username, "date": schedule_data.date}, schedule_doc, upsert=True)
    return {"message": "Schedule updated successfully"}

@app.get("/schedule/{date}", response_model=DaySchedule)
async def get_schedule(date: str, current_user: Annotated[User, Depends(get_current_user)]):
    if not (schedule := schedule_collection.find_one({"username": current_user.username, "date": date})):
        return DaySchedule(date=date, busy_times=[], free_times=[], is_available=True)
    return DaySchedule(**schedule)

@app.get("/schedule/", response_model=List[DaySchedule])
async def get_schedule_range(start_date: str, end_date: str, current_user: Annotated[User, Depends(get_current_user)]):
    schedules = schedule_collection.find({"username": current_user.username, "date": {"$gte": start_date, "$lte": end_date}})
    return [DaySchedule(**s) for s in schedules]

@app.delete("/schedule/{date}", status_code=200)
async def delete_schedule(date: str, current_user: Annotated[User, Depends(get_current_user)]):
    result = schedule_collection.delete_one({"username": current_user.username, "date": date})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return {"message": "Schedule deleted successfully"}

# ... Friends Endpoints ...
@app.get("/users/search", response_model=List[UserSearchResult])
async def search_users(query: str, current_user: Annotated[User, Depends(get_current_user)]):
    if not query: return []
    regex = {"$regex": query, "$options": "i"}
    users = user_collection.find({"$and": [{"username": {"$ne": current_user.username}}, {"$or": [{"username": regex}, {"display_name": regex}]}]}).limit(10)

    results = []
    for doc in users:
        target = User(**doc)
        status = "not_friends"
        if target.username in current_user.friends: status = "friends"
        elif target.username in current_user.friend_requests: status = "request_received"
        elif current_user.username in target.friend_requests: status = "request_sent"
        results.append(UserSearchResult(username=target.username, display_name=target.display_name, friendship_status=status))
    return results

# ... other friend endpoints ...
@app.post("/friends/request")
async def send_friend_request(request: FriendRequest, current_user: Annotated[User, Depends(get_current_user)]):
    if request.to_username == current_user.username: raise HTTPException(status_code=400, detail="Cannot request yourself.")
    if not await get_current_user_from_db(request.to_username): raise HTTPException(status_code=404, detail="User not found.")
    user_collection.update_one({"username": request.to_username}, {"$addToSet": {"friend_requests": current_user.username}})
    return {"message": "Friend request sent."}

@app.post("/friends/respond")
async def respond_to_friend_request(response: FriendRequestResponse, current_user: Annotated[User, Depends(get_current_user)]):
    user_collection.update_one({"username": current_user.username}, {"$pull": {"friend_requests": response.from_username}})
    if response.accept:
        user_collection.update_one({"username": current_user.username}, {"$addToSet": {"friends": response.from_username}})
        user_collection.update_one({"username": response.from_username}, {"$addToSet": {"friends": current_user.username}})
        return {"message": "Friend request accepted."}
    return {"message": "Friend request declined."}

@app.delete("/friends/{friend_username}")
async def remove_friend(friend_username: str, current_user: Annotated[User, Depends(get_current_user)]):
    user_collection.update_one({"username": current_user.username}, {"$pull": {"friends": friend_username}})
    user_collection.update_one({"username": friend_username}, {"$pull": {"friends": current_user.username}})
    match_collection.delete_one({"users": sorted([current_user.username, friend_username])})
    return {"message": "Friend removed."}

@app.get("/friends/", response_model=List[dict])
async def get_friends(current_user: Annotated[User, Depends(get_current_user)]):
    if not current_user.friends: return []
    cursor = user_collection.find({"username": {"$in": current_user.friends}})
    return [{"username": f["username"], "display_name": f["display_name"]} for f in cursor]

@app.get("/friends/requests", response_model=List[dict])
async def get_friend_requests(current_user: Annotated[User, Depends(get_current_user)]):
    if not current_user.friend_requests: return []
    cursor = user_collection.find({"username": {"$in": current_user.friend_requests}})
    return [{"username": r["username"], "display_name": r["display_name"]} for r in cursor]


# --- Schedule Match Endpoints ---
@app.get("/matches", response_model=List[ScheduleMatch])
async def get_my_matches(current_user: Annotated[User, Depends(get_current_user)]):
    matches_cursor = match_collection.find({"users": current_user.username, "status": "active"})
    
    # *** THIS IS THE FIX ***
    results = []
    for m in matches_cursor:
        # Create a new dictionary that Pydantic can safely validate.
        # We pop the ObjectId `_id` and create a string `match_id`.
        m["match_id"] = str(m.pop("_id"))
        results.append(ScheduleMatch(**m))
    return results

@app.post("/matches/request/{friend_username}", status_code=201)
async def request_schedule_match(friend_username: str, current_user: Annotated[User, Depends(get_current_user)]):
    if friend_username not in current_user.friends: raise HTTPException(status_code=400, detail="Can only send match requests to friends.")
    users = sorted([current_user.username, friend_username])
    if match_collection.find_one({"users": users}): raise HTTPException(status_code=400, detail="A match or request already exists.")
    
    match_doc = {"users": users, "status": "pending", "requested_by": current_user.username, "created_at": datetime.now(timezone.utc)}
    match_collection.insert_one(match_doc)
    user_collection.update_one({"username": friend_username}, {"$addToSet": {"match_requests": current_user.username}})
    return {"message": "Schedule Match request sent."}

@app.post("/matches/respond/{from_username}")
async def respond_to_match_request(from_username: str, accept: bool, current_user: Annotated[User, Depends(get_current_user)]):
    user_collection.update_one({"username": current_user.username}, {"$pull": {"match_requests": from_username}})
    users = sorted([current_user.username, from_username])
    if accept:
        match_collection.update_one({"users": users, "requested_by": from_username}, {"$set": {"status": "active"}})
        return {"message": "Match request accepted."}
    else:
        match_collection.delete_one({"users": users})
        return {"message": "Match request declined."}

@app.get("/matches/requests", response_model=List[str])
async def get_my_match_requests(current_user: Annotated[User, Depends(get_current_user)]):
    return current_user.match_requests

@app.get("/matches/overlap/{friend_username}/{date_str}", response_model=OverlapResult)
async def get_overlap(friend_username: str, date_str: str, current_user: Annotated[User, Depends(get_current_user)]):
    friend_user = await get_current_user_from_db(friend_username)
    if not friend_user: raise HTTPException(status_code=404, detail="Friend not found.")
    users = sorted([current_user.username, friend_username])
    if not match_collection.find_one({"users": users, "status": "active"}): raise HTTPException(status_code=403, detail="No active schedule match.")
    
    overlaps, friend_slots, my_slots = calculate_overlaps(date_str, friend_user, current_user)
    return OverlapResult(date=date_str, overlaps=overlaps, user_a_slots=friend_slots, user_b_slots=my_slots)

@app.delete("/matches/{friend_username}")
async def delete_match(friend_username: str, current_user: Annotated[User, Depends(get_current_user)]):
    users = sorted([current_user.username, friend_username])
    result = match_collection.delete_one({"users": users})
    if result.deleted_count == 0: raise HTTPException(status_code=404, detail="Match not found.")
    return {"message": "Schedule Match removed."}