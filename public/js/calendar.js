const calendarEl = document.getElementById('calendar');
const monthYearEl = document.getElementById('monthYear');
const prevMonthBtn = document.getElementById('prevMonth');
const nextMonthBtn = document.getElementById('nextMonth');

let currentDate = new Date();
let workouts = [];

const token = localStorage.getItem('token');

// Fetch workouts
fetch('/api/workouts', {headers: { 'Authorization': 'Bearer ' + token }})
    .then(res => res.json())
    .then(data => {
        workouts = data;
        renderCalendar(currentDate);
    });

prevMonthBtn.addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar(currentDate);
});

nextMonthBtn.addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar(currentDate);
});

function renderCalendar(date) {
    calendarEl.innerHTML = '';

    const year = date.getFullYear();
    const month = date.getMonth();
    monthYearEl.textContent = date.toLocaleString('default', { month: 'long', year: 'numeric' });

    // Weekday headers
    const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    weekdays.forEach(day => {
        const header = document.createElement('div');
        header.className = 'weekday-header';
        header.textContent = day;
        calendarEl.appendChild(header);
    });

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDay = firstDay.getDay();

    // Empty slots before first day
    for(let i=0;i<startDay;i++){
        const empty = document.createElement('div');
        empty.className = 'calendar-day';
        calendarEl.appendChild(empty);
    }

    // Days of the month
    for(let day=1; day<=lastDay.getDate(); day++){
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';

        const dayNumber = document.createElement('div');
        dayNumber.className = 'calendar-day-number';
        dayNumber.textContent = day;
        dayEl.appendChild(dayNumber);

        // Add events for this day
        const dayStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        workouts.forEach(w => {
            if(w.on_upload === 'zones'){
            const workoutDate = new Date(w.workout_date);
            const workoutStr = workoutDate.toISOString().split('T')[0];

            if (workoutStr === dayStr) {
                const ev = document.createElement('div');
                if(w.sport === "Biking"){
                    ev.style.borderLeftColor = "orange"
                }
                if(w.sport === "Running"){
                    ev.style.borderLeftColor = "blue"
                }
                if(w.sport === "Other"){
                    ev.style.borderLeftColor = "green"
                }
                ev.className = 'event';
                ev.textContent = `TSS: ${Math.round(w.tss) ?? 'N/A'}`;
                ev.onclick = () => window.location.href = `detail.html?id=${w.id}`;
                dayEl.appendChild(ev);
            }
        }
        });

        calendarEl.appendChild(dayEl);
    }
}