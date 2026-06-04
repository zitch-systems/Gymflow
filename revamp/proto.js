// Shared prototype role-switcher. Call buildProto('<current>') after DOM ready.
function buildProto(current) {
  const items = [
    { p:'marketing', href:'marketing.html', icon:'globe', label:'Site' },
    { p:'login', href:'login.html', icon:'log-in', label:'Login' },
    { p:'member', href:'member.html', icon:'user', label:'Member' },
    { p:'admin', href:'admin.html', icon:'layout-dashboard', label:'Admin' },
    { p:'instructor', href:'instructor.html', icon:'graduation-cap', label:'Coach' },
    { p:'superadmin', href:'superadmin.html', icon:'shield-check', label:'Platform' },
  ];
  const el = document.getElementById('proto');
  if (!el) return;
  el.innerHTML = '<span class="lbl-tag">Preview</span>' + items.map(i =>
    `<a href="${i.href}" class="${i.p===current?'on':''}"><i data-lucide="${i.icon}"></i><span>${i.label}</span></a>`
  ).join('');
  if (window.lucide) lucide.createIcons();
}
