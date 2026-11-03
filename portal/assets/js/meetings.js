function displayMeetingsTable() {
  const tbody = document.getElementById('meetings-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  mockMeetings.forEach(m => {
    const totalParticipants = Object.values(m.attendance).reduce((sum, arr) => sum + arr.length, 0);
    const row = `<tr>
      <td>${m.meetingId}</td>
      <td>${m.date}</td>
      <td>${m.presenter}</td>
      <td>${m.place}</td>
      <td>${m.topic}</td>
      <td>${totalParticipants}</td>
      <td><button class="btn-outline btn-sm" onclick="openAttendanceModal('${m.meetingId}')"><i class="fa-solid fa-check"></i> Mark</button></td>
    </tr>`;
    tbody.innerHTML += row;
  });
}

function openCreateMeetingModal() {
  document.getElementById('meetingModal').classList.add('active');
  document.getElementById('meeting-id').value = 'M' + (mockMeetings.length + 1).toString().padStart(3, '0');
}

function closeMeetingModal() {
  document.getElementById('meetingModal').classList.remove('active');
}

function saveMeeting() {
  const newMeeting = {
    meetingId: document.getElementById('meeting-id').value,
    date: document.getElementById('meeting-date').value,
    presenter: document.getElementById('presenter').value,
    place: document.getElementById('place').value,
    topic: document.getElementById('topic').value,
    attendance: {}
  };
  mockMeetings.push(newMeeting);
  closeMeetingModal();
  displayMeetingsTable();
}

function openAttendanceModal(meetingId) {
  alert('Attendance marking UI would open here. (Demo)');
}