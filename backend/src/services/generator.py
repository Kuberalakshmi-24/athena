class Generator:
    def __init__(self):
        pass

    def create_response(self, data):
        # Logic to create a response based on the retrieved data
        response = f"Generated response based on: {data}"
        return response

    def format_output(self, response):
        # Logic to format the output
        formatted_response = response.strip().capitalize()
        return formatted_response