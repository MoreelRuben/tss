function renderHeaderFooter() {
    const header = `
        <header>
            <a href="index.html" class="logo">
                <img src="./assets/logo.png" alt="TSS Tracker Logo" />
            </a>
            <nav>
                <a href="home.html">Home</a>
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
