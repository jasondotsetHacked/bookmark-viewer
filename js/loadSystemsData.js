export async function loadSystemsData() {
    const url = new URL('../data/systems.json', import.meta.url);
    console.log(`Fetching systems data from: ${url.href}`);
    const response = await fetch(url);
    console.log(`Response status: ${response.status}`);
    if (!response.ok) {
        console.error(`Failed to fetch systems data: ${response.statusText}`);
        return [];
    }
    const data = await response.json();
    return data.systems;
}
