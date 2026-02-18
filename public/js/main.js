function renderHeaderFooter() {
    const header = `
        <header>
            <h1>TSS Tracker</h1>
            <nav>
                <a href="index.html">Home</a>
                <a href="upload.html">Upload</a>
                <a href="calendar.html">Calendar</a>
            </nav>
        </header>
    `;

    const footer = `
        <footer>
            <p>&copy; 2026 TSS Tracker</p>
        </footer>
    `;

    document.body.insertAdjacentHTML('afterbegin', header);
    document.body.insertAdjacentHTML('beforeend', footer);
}

document.addEventListener('DOMContentLoaded', renderHeaderFooter);
