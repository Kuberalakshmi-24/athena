# RAG Tutoring System Backend

This is the backend part of the RAG Tutoring System project. It is built using Python and Flask.

## Setup Instructions

1. **Clone the repository:**
   ```
   git clone <repository-url>
   cd rag-tutoring-system/backend
   ```

2. **Create a virtual environment:**
   ```
   python -m venv venv
   ```

3. **Activate the virtual environment:**
   - On Windows:
     ```
     venv\Scripts\activate
     ```
   - On macOS/Linux:
     ```
     source venv/bin/activate
     ```

4. **Install the required dependencies:**
   ```
   pip install -r requirements.txt
   ```

5. **Run the application:**
   ```
   python src/app.py
   ```

## Docker

Build and run the backend with Docker:

```
docker build -t rag-backend .
docker run --rm -p 5000:5000 --env-file .env rag-backend
```

## Usage Guidelines

- The backend API is accessible at `http://localhost:5000`.
- You can interact with the API using tools like Postman or through the frontend application.
- Ensure that the database or any external services required by the application are properly configured.

## Directory Structure

- `src/`: Contains the main application code.
  - `app.py`: Entry point of the application.
  - `api/`: Contains the API routes.
  - `services/`: Contains business logic for data retrieval and response generation.
  - `types/`: Contains custom types and data models.

## Contributing

Feel free to submit issues or pull requests for improvements or bug fixes.