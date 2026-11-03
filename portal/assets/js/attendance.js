function loadAttendanceForLeader(convocation) {
  // For demo, just load the first meeting
  if (mockMeetings.length === 0) return;
  const meeting = mockMeetings[0];
  const tbody = document.getElementById('attendance-tbody');
  tbody.innerHTML = '';
  const students = mockStudents.filter(s => s.convocation === convocation);
  const attendedIds = meeting.attendance[convocation] || [];
  students.forEach(s => {
    const checked = attendedIds.includes(s.id) ? 'checked' : '';
    tbody.innerHTML += `<tr>
      <td>${s.id}</td><td>${s.name}</td>
      <td><input type="checkbox" class="attendance-check" data-id="${s.id}" ${checked}></td>
    </tr>`;
  });
}