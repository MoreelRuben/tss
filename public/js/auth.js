// auth.js - include this on all pages
(async function checkAuth() {
    const token = localStorage.getItem('token'); // change key if needed

    // If no token, redirect to login
    if (!token) {
        redirectToLogin();
        return;
    }

    try {
        // Validate token with your backend
        const response = await fetch('/api/validate-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            // Token invalid or expired
            localStorage.removeItem('token');
            redirectToLogin();
            return;
        }

        // Token is valid, you can optionally get user info
        const data = await response.json();
        console.log('User authenticated:', data.user);

    } catch (err) {
        console.error('Error validating token:', err);
        redirectToLogin();
    }

    function redirectToLogin() {
        // Adjust your login URL
        window.location.href = '/login.html';
    }
})();