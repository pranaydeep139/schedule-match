# Duckhog Schedule Match 🐧

Duckhog Schedule Match is a modern, full-stack web application designed to help users manage their personal schedules and effortlessly find common free time with their friends across different timezones.

It features an intuitive weekly calendar, a dynamic friend system, and a powerful "Schedule Match" tool that automatically calculates and displays overlapping availability, making it simple to coordinate meetings, calls, and activities.

---

## ✨ Features

*   **Secure User Authentication:** Register and log in securely with JWT (JSON Web Token) based authentication.
*   **Dynamic Weekly Calendar:** View your schedule on a responsive, mobile-first weekly grid. Navigate easily between weeks.
*   **Intuitive Schedule Management:**
    *   Mark entire days as available or unavailable.
    *   Add specific "Free Time" and "Busy Time" slots with a simple, interactive UI.
    *   Input validation prevents creating overlapping time slots.
    *   12-hour (AM/PM) time selection for a user-friendly experience.
*   **Friend System:**
    *   Search for other users dynamically.
    *   Send and manage friend requests.
    *   View a clean list of your friends.
*   **Timezone-Aware Schedule Matching:**
    *   Send "Match" requests to friends to share schedules.
    *   Once a match is active, view a special overlap interface.
    *   The app **automatically calculates and displays common free times**, converting them to each user's local timezone.
    *   Redundant time slots are merged into single, continuous blocks for clarity (e.g., 2:00-3:00 and 3:00-4:00 becomes 2:00-4:00).

---

## 🛠️ Tech Stack

*   **Backend:** Python with **FastAPI**
*   **Database:** **MongoDB**
*   **Frontend:** Plain **JavaScript (ES6)**, HTML5, CSS3 (No frameworks)
*   **Security:** Passlib for password hashing, python-jose for JWTs.
*   **Timezones:** `pytz` on the backend for robust timezone calculations.

---

## 🚀 Getting Started

### Prerequisites

*   Python 3.8+
*   Node.js (for `http-server` or similar, to serve the frontend)
*   A running MongoDB instance (local or on [MongoDB Atlas](https://www.mongodb.com/cloud/atlas))

### Backend Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd schedule-match/backend
    ```

2.  **Create a virtual environment and install dependencies:**
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    pip install -r requirements.txt
    ```

3.  **Configure Environment Variables:**
    Create a `.env` file inside the `backend` folder and add your configuration:
    ```env
    MONGO_DETAILS="your_mongodb_connection_string"
    SECRET_KEY="your_secret_key"
    ALGORITHM="HS256"
    ```

4.  **Run the server:**
    ```bash
    uvicorn main:app --reload
    ```
    The backend will be running at `http://127.0.0.1:8000`.

### Frontend Setup

1.  **Serve the frontend files:**
    In a **new terminal**, navigate to the `frontend` directory:
    ```bash
    cd ../frontend
    ```

2.  **Use a simple HTTP server:**
    If you have Python 3, you can use its built-in server:
    ```bash
    python -m http.server
    ```
    Or use the popular `serve` package from npm:
    ```bash
    npx serve
    ```

3.  **Access the App:**
    Open your browser and navigate to `http://localhost:8000` (for Python's server) or the URL provided by `serve` (usually `http://localhost:3000`).

---