// Mock Students Data
const mockStudents = [
  { id: 'S001', name: 'Ali Ahmed', convocation: 'Dufcadda 1', role: 'Student', meetingsMissed: 2, paymentStatus: 'Paid', profilePic: '', isLeader: false },
  { id: 'S002', name: 'Hawa Mohamud', convocation: 'Dufcadda 1', role: 'Leader', meetingsMissed: 0, paymentStatus: 'Paid', profilePic: '', isLeader: true },
  { id: 'S003', name: 'Mohamed Farah', convocation: 'Dufcadda 2', role: 'Student', meetingsMissed: 5, paymentStatus: 'Unpaid', profilePic: '', isLeader: false },
  { id: 'S004', name: 'Asha Osman', convocation: 'Dufcadda 2', role: 'Student', meetingsMissed: 1, paymentStatus: 'Paid', profilePic: '', isLeader: false },
  { id: 'S005', name: 'Khadar Abdi', convocation: 'Dufcadda 3', role: 'Student', meetingsMissed: 0, paymentStatus: 'Paid', profilePic: '', isLeader: false },
  { id: 'S006', name: 'Safia Ali', convocation: 'Dufcadda 3', role: 'Leader', meetingsMissed: 0, paymentStatus: 'Paid', profilePic: '', isLeader: true },
];

// Mock Meetings
let mockMeetings = [
  { meetingId: 'M001', date: '2025-02-20', presenter: 'Abdirahman', place: 'Hall A', topic: 'Orientation', attendance: { 'Dufcadda 1': ['S001', 'S002'], 'Dufcadda 2': ['S003'], 'Dufcadda 3': ['S005'] } },
  { meetingId: 'M002', date: '2025-02-27', presenter: 'Maryan', place: 'Room 101', topic: 'Leadership', attendance: { 'Dufcadda 1': ['S001'], 'Dufcadda 2': ['S003', 'S004'], 'Dufcadda 3': ['S005', 'S006'] } },
];

// Mock Payments (per student per month)
const mockPaymentRecords = [
  { studentId: 'S001', year: 2025, months: { Jan: 'Paid', Feb: 'Paid', Mar: 'Unpaid' } },
  { studentId: 'S002', year: 2025, months: { Jan: 'Paid', Feb: 'Paid', Mar: 'Paid' } },
  { studentId: 'S003', year: 2025, months: { Jan: 'Unpaid', Feb: 'Unpaid', Mar: 'Unpaid' } },
  { studentId: 'S004', year: 2025, months: { Jan: 'Paid', Feb: 'Paid', Mar: 'Paid' } },
  { studentId: 'S005', year: 2025, months: { Jan: 'Paid', Feb: 'Unpaid', Mar: 'Paid' } },
  { studentId: 'S006', year: 2025, months: { Jan: 'Paid', Feb: 'Paid', Mar: 'Paid' } },
];

// Helper functions
function getStudentsByConvocation(conv) {
  if (conv === 'all') return mockStudents;
  return mockStudents.filter(s => s.convocation === conv);
}

function searchStudents(query) {
  const q = query.toLowerCase();
  return mockStudents.filter(s => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
}

function calculateConvocationStats(conv) {
  const students = mockStudents.filter(s => s.convocation === conv);
  const total = students.length;
  const unpaid = students.filter(s => s.paymentStatus === 'Unpaid').length;
  const percentPaid = total ? ((total - unpaid) / total * 100).toFixed(1) : 0;
  return { total, unpaid, percentPaid };
}