const API_BASE_URL = 'http://localhost:3000/customers';
const responseDiv = document.getElementById('response');

function displayResponse(data) {
    responseDiv.textContent = JSON.stringify(data, null, 2);
}

document.getElementById('getAllTrips').addEventListener('click', async () => {
    try {
        const response = await fetch(API_BASE_URL);
        const data = await response.json();
        displayResponse(data);
    } catch (error) {
        displayResponse({ error: error.message });
    }
});