function loadUnpaidTable() {
  const tbody = document.getElementById('unpaid-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const unpaidStudents = mockStudents.filter(s => s.paymentStatus === 'Unpaid');
  unpaidStudents.forEach(s => {
    const row = `<tr><td>${s.id}</td><td>${s.name}</td><td>${s.convocation}</td><td><span class="status-badge status-unpaid">Unpaid</span></td></tr>`;
    tbody.innerHTML += row;
  });
}

function calculatePaymentPercentage() {
  const convs = ['Dufcadda 1', 'Dufcadda 2', 'Dufcadda 3'];
  const stats = convs.map(c => calculateConvocationStats(c));
  return stats;
}