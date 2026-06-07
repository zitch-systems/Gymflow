/* ============================================================
   GymFlow Member app — logic
   Views: home · schedule · classdetail · checkin · wallet ·
          receipt · renew · notifications · profile
   ============================================================ */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ───────────────────────── data ───────────────────────── */

// week calendar strip — today is Wed 11
const WEEK = [
  { dow:'Mon', date:9,  key:'mon' },
  { dow:'Tue', date:10, key:'tue' },
  { dow:'Wed', date:11, key:'wed', today:true },
  { dow:'Thu', date:12, key:'thu' },
  { dow:'Fri', date:13, key:'fri' },
  { dow:'Sat', date:14, key:'sat' },
  { dow:'Sun', date:15, key:'sun' },
];

// classes by day — full detail consumed by openClass()
const SCHEDULE = {
  mon: [
    { n:'Power Lifting', time:'09:00', ap:'AM', coach:'Coach Femi', cap:'12/15 booked', state:'book', img:'gym-barbell.jpg', dur:'60 min', when:'Mon 9 · 09:00 · 60 min', desc:'Strength-focused barbell session covering squat, bench and deadlift technique with coached progressions.' },
    { n:'Yoga Flow', time:'19:00', ap:'PM', coach:'Coach Ada', cap:'9/16 booked', state:'book', img:'gym-kettlebells.jpg', dur:'60 min', when:'Mon 9 · 19:00 · 60 min', desc:'A calming vinyasa flow to stretch, breathe and unwind. Mats provided — just bring yourself.' },
  ],
  tue: [
    { n:'Sunrise HIIT', time:'06:30', ap:'AM', coach:'Coach Bisi', cap:'16/20 booked', state:'book', img:'gym-studio.jpg', dur:'45 min', when:'Tue 10 · 06:30 · 45 min', desc:'A fast, full-body HIIT circuit to start your day. Short bursts of high-intensity work with active recovery — scalable for every level.' },
    { n:'Strength 101', time:'17:00', ap:'PM', coach:'Coach Femi', cap:'8/14 booked', state:'book', img:'gym-machines.jpg', dur:'50 min', when:'Tue 10 · 17:00 · 50 min', desc:'A coached intro to the big lifts and machines — perfect if you are building a base.' },
  ],
  wed: [
    { n:'Sunrise HIIT', time:'06:30', ap:'AM', coach:'Coach Bisi', cap:'18/20 booked', state:'book', img:'gym-studio.jpg', dur:'45 min', when:'Today · 06:30 · 45 min', desc:'A fast, full-body HIIT circuit to start your day. Short bursts of high-intensity work with active recovery — scalable for every level.', few:true },
    { n:'Power Lifting', time:'09:00', ap:'AM', coach:'Coach Femi', cap:'12/15 booked', state:'book', img:'gym-barbell.jpg', dur:'60 min', when:'Today · 09:00 · 60 min', desc:'Strength-focused barbell session covering squat, bench and deadlift technique with coached progressions.' },
    { n:'Spin Class', time:'17:30', ap:'PM', coach:'Coach Tobi', cap:'22/24 booked', state:'booked', img:'gym-bikes.jpg', dur:'45 min', when:'Today · 17:30 · 45 min', desc:'A high-energy indoor cycling ride through climbs and sprints, set to music. Bring water and a towel.' },
    { n:'Yoga Flow', time:'19:00', ap:'PM', coach:'Coach Ada', cap:'9/16 booked', state:'book', img:'gym-kettlebells.jpg', dur:'60 min', when:'Today · 19:00 · 60 min', desc:'A calming vinyasa flow to stretch, breathe and unwind. Mats provided — just bring yourself.' },
  ],
  thu: [
    { n:'Boxing Conditioning', time:'18:00', ap:'PM', coach:'Coach Tobi', cap:'11/16 booked', state:'book', img:'gym-floor.jpg', dur:'50 min', when:'Thu 12 · 18:00 · 50 min', desc:'Pad work, footwork and conditioning rounds. Wraps recommended; gloves available to borrow.' },
  ],
  fri: [
    { n:'Sunrise HIIT', time:'06:30', ap:'AM', coach:'Coach Bisi', cap:'14/20 booked', state:'book', img:'gym-studio.jpg', dur:'45 min', when:'Fri 13 · 06:30 · 45 min', desc:'A fast, full-body HIIT circuit to start your day.' },
    { n:'Yoga Flow', time:'19:00', ap:'PM', coach:'Coach Ada', cap:'12/16 booked', state:'booked', img:'gym-kettlebells.jpg', dur:'60 min', when:'Fri 13 · 19:00 · 60 min', desc:'A calming vinyasa flow to stretch, breathe and unwind. Mats provided — just bring yourself.' },
  ],
  sat: [
    { n:'Open Floor', time:'08:00', ap:'AM', coach:'Self-guided', cap:'Drop-in', state:'book', img:'gym-dumbbells.jpg', dur:'120 min', when:'Sat 14 · 08:00 · open', desc:'No class — the floor is yours. Coaches roam for form checks.' },
  ],
  sun: [],
};

// my bookings (upcoming)
let BOOKINGS = [
  { d:11, dow:'Wed', n:'Spin Class', sub:'Coach Tobi · 17:30 · today', key:'wed' },
  { d:13, dow:'Fri', n:'Yoga Flow', sub:'Coach Ada · 19:00', key:'fri' },
];

let curClass = null;          // class open in detail
let curDay = 'wed';           // selected schedule day
let payPlan = { n:'Quarterly', a:'37,999' };

/* ───────────────────────── view nav ───────────────────────── */
function go(v) {
  $$('.view').forEach(x => x.classList.toggle('on', x.dataset.v === v));
  const tabMap = { classdetail:'schedule', receipt:'wallet', renew:'wallet', notifications:'home' };
  const tab = tabMap[v] || v;
  $$('.tabbar button, .rail button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (v === 'checkin')  resetCi();
  if (v === 'renew')    resetRenew();
  if (v === 'wallet')   resetWallet();
  $('.scr').scrollTop = 0;
  lucide.createIcons();
}

/* ───────────────────────── check-in ───────────────────────── */
function checkIn() { $('#ciMain').style.display = 'none'; $('#ciOk').classList.add('on'); lucide.createIcons(); }
function resetCi() { $('#ciMain').style.display = 'block'; $('#ciOk').classList.remove('on'); }

/* ───────────────────────── schedule ───────────────────────── */
function buildCalStrip() {
  $('#calStrip').innerHTML = WEEK.map(d => {
    const has = (SCHEDULE[d.key] || []).length > 0;
    const booked = BOOKINGS.some(b => b.key === d.key);
    return `<div class="cday${d.key===curDay?' on':''}" data-day="${d.key}" onclick="selectDay('${d.key}')">
      <span>${d.dow}</span><b>${d.date}</b>
      <i class="mk ${has?'':'ghost'}" ${booked?'style="background:var(--gf-accent)"':''}></i></div>`;
  }).join('');
}
function selectDay(key) {
  curDay = key;
  $$('.cday').forEach(c => c.classList.toggle('on', c.dataset.day === key));
  renderDay(key);
}
function renderDay(key) {
  const list = SCHEDULE[key] || [];
  const d = WEEK.find(w => w.key === key);
  $('#dayLabel').textContent = d.today ? 'Today · Wed 11' : `${d.dow} ${d.date}`;
  const wrap = $('#dayClasses');
  if (!list.length) {
    wrap.innerHTML = `<div class="empty"><div class="eic"><i data-lucide="coffee"></i></div><h3>Rest day</h3><p>No classes scheduled. Recovery counts too.</p></div>`;
    lucide.createIcons(); return;
  }
  wrap.innerHTML = list.map((c, i) => {
    const badge = c.state === 'booked'
      ? '<span class="gf-badge gf-badge-success" style="padding:5px 9px">Booked</span>'
      : c.few ? '<span class="gf-badge gf-badge-warning" style="padding:5px 9px">2 left</span>' : '';
    return `<div class="cls-card" onclick="openClass(this)"
        data-day="${key}" data-i="${i}"
        data-n="${c.n}" data-time="${c.time}" data-when="${c.when}" data-dur="${c.dur}"
        data-coach="${c.coach}" data-cap="${c.cap}" data-state="${c.state}" data-img="${c.img}" data-desc="${c.desc}">
      <div class="tm"><b>${c.time}</b><span>${c.ap}</span></div>
      <div class="info"><strong>${c.n}</strong><small>${c.coach} · ${c.cap}</small></div>
      ${badge}<i data-lucide="chevron-right" class="chev"></i></div>`;
  }).join('');
  lucide.createIcons();
}
function scheduleTab(t) {
  $$('#schedTabs button').forEach(b => b.classList.toggle('on', b.dataset.st === t));
  $('#schedCal').style.display     = t === 'cal' ? 'block' : 'none';
  $('#schedBookings').style.display = t === 'book' ? 'block' : 'none';
  if (t === 'book') renderBookings();
}
function renderBookings() {
  const wrap = $('#bookingsList');
  if (!BOOKINGS.length) {
    wrap.innerHTML = `<div class="empty"><div class="eic"><i data-lucide="calendar-x"></i></div><h3>No upcoming bookings</h3><p>Browse the schedule and reserve your spot.</p><button class="gf-btn gf-btn-primary" onclick="scheduleTab('cal')">Browse classes</button></div>`;
    lucide.createIcons(); return;
  }
  wrap.innerHTML = BOOKINGS.map((b, i) => `
    <div class="bkg" id="bkg-${i}">
      <div class="date"><b>${b.d}</b><span>${b.dow}</span></div>
      <div class="m"><strong>${b.n}</strong><small>${b.sub}</small></div>
      <button class="cancel" onclick="cancelBooking(${i})">Cancel</button>
    </div>`).join('');
  lucide.createIcons();
}
function cancelBooking(i) {
  const b = BOOKINGS[i];
  BOOKINGS.splice(i, 1);
  renderBookings();
  buildCalStrip();
  if (window.gfToast) gfToast(`Cancelled ${b.n}`);
}

/* ───────────────────────── class detail ───────────────────────── */
function openClass(el) {
  const d = el.dataset;
  curClass = { n:d.n, time:d.time, when:d.when, key:d.day,
    dow: (WEEK.find(w => w.key === d.day) || {}).dow, date:(WEEK.find(w => w.key === d.day) || {}).date, coach:d.coach };
  $('#cdName').textContent = d.n; $('#cdWhen').textContent = d.when; $('#cdImg').src = '../assets/' + d.img;
  $('#cdCoach').textContent = d.coach; $('#cdCoachAv').textContent = d.coach.replace('Coach ', '').charAt(0);
  $('#cdDesc').textContent = d.desc;
  $('#cdOkName').textContent = d.n; $('#cdOkWhen').textContent = d.time;
  $('#cdBadges').innerHTML = `<span class="gf-badge gf-badge-neutral">${d.time}</span><span class="gf-badge gf-badge-success">${d.cap}</span><span class="gf-badge gf-badge-brand">${d.dur}</span>`;
  const btn = $('#cdBookBtn');
  if (d.state === 'booked') {
    btn.className = 'gf-btn gf-btn-secondary gf-btn-full gf-btn-lg';
    btn.innerHTML = '<i data-lucide="check" style="width:18px;height:18px"></i> You\u2019re booked';
    btn.onclick = () => go('home');
  } else {
    btn.className = 'gf-btn gf-btn-primary gf-btn-full gf-btn-lg';
    btn.innerHTML = '<i data-lucide="calendar-plus" style="width:18px;height:18px"></i> Book your spot';
    btn.onclick = bookClass;
  }
  $('#cdMain').style.display = 'block'; $('#cdOk').classList.remove('on');
  go('classdetail');
}
function bookClass() {
  if (curClass && !BOOKINGS.some(b => b.n === curClass.n && b.key === curClass.key)) {
    BOOKINGS.push({ d:curClass.date, dow:curClass.dow, n:curClass.n, sub:`${curClass.coach} · ${curClass.time}`, key:curClass.key });
    buildCalStrip();
  }
  $('#cdMain').style.display = 'none'; $('#cdOk').classList.add('on'); lucide.createIcons();
}

/* ───────────────────────── renew ───────────────────────── */
function pick(el) {
  $$('.rplan').forEach(x => x.classList.remove('on')); el.classList.add('on');
  payPlan = { n:el.dataset.plan, a:el.dataset.amt };
  $('#payBtn').innerHTML = '<i data-lucide="credit-card" style="width:18px;height:18px"></i> Pay \u20a6' + payPlan.a + ' with Paystack';
  lucide.createIcons();
}
function pay() { $('#okPlan').textContent = payPlan.n; $('#renewPick').style.display = 'none'; $('#renewOk').classList.add('on'); lucide.createIcons(); }
function resetRenew() { $('#renewPick').style.display = 'block'; $('#renewOk').classList.remove('on'); }

/* ───────────────────────── wallet ───────────────────────── */
function resetWallet() { $('#walletMain').style.display = 'block'; }
function toggleAutoDebit(el) {
  el.classList.toggle('on');
  if (window.gfToast) gfToast(el.classList.contains('on') ? 'Auto-debit on' : 'Auto-debit off');
}
function openReceipt(el) {
  const d = el.dataset;
  $('#rcAmt').textContent = (d.dir === 'in' ? '+\u20a6' : '\u20a6') + d.amt;
  $('#rcLabel').textContent = d.title;
  $('#rcList').innerHTML = `
    <div class="rrow"><span>Reference</span><b>${d.ref}</b></div>
    <div class="rrow"><span>Date</span><b>${d.date}</b></div>
    <div class="rrow"><span>Method</span><b>${d.method}</b></div>
    <div class="rrow"><span>Status</span><b style="color:var(--gf-brand)">Successful</b></div>
    <div class="rrow"><span>Amount</span><b>${(d.dir==='in'?'+\u20a6':'\u20a6')}${d.amt}</b></div>`;
  go('receipt');
}

/* ───────────────────────── notifications ───────────────────────── */
function updateBellNub() {
  const n = $$('.notif.unread').length;
  $$('.bell .nub').forEach(el => { el.textContent = n; el.classList.toggle('hide', n === 0); });
  $$('.nav-dot').forEach(el => el.style.display = n === 0 ? 'none' : 'block');
}
function openNotif(el) {
  el.classList.remove('unread');
  updateBellNub();
  const goto = el.dataset.go;
  if (goto) go(goto);
}
function markAllRead() {
  $$('.notif.unread').forEach(el => el.classList.remove('unread'));
  updateBellNub();
  if (window.gfToast) gfToast('All caught up');
}

/* ───────────────────────── device + theme + fit ───────────────────────── */
function setDevice(d) {
  $('#device').className = 'device ' + d;
  document.body.classList.toggle('expanded', d !== 'phone');
  document.body.classList.remove('dev-phone', 'dev-fold', 'dev-tablet');
  document.body.classList.add('dev-' + d);
  fit();
}
function fit() {
  const d = $('#device'), box = $('#fitbox');
  d.style.transform = 'none';
  const natW = d.offsetWidth, natH = d.offsetHeight;
  const availW = window.innerWidth - 40;
  const availH = window.innerHeight - 150;
  const r = Math.min(1, availW / natW, availH / natH);
  d.style.transform = 'scale(' + r + ')';
  box.style.width = (natW * r) + 'px';
  box.style.height = (natH * r) + 'px';
}
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('gf-theme', t); } catch (e) {}
  $('#themeBtn').innerHTML = '<i data-lucide="' + (t === 'light' ? 'moon' : 'sun') + '"></i>';
  lucide.createIcons();
}

/* ───────────────────────── init ───────────────────────── */
window.addEventListener('resize', fit);
document.addEventListener('DOMContentLoaded', () => {
  $$('#devSeg button').forEach(b => b.onclick = () => {
    $$('#devSeg button').forEach(x => x.classList.remove('on')); b.classList.add('on');
    setDevice(b.dataset.dev);
  });
  $('#themeBtn').onclick = () => setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  try { const t = localStorage.getItem('gf-theme'); if (t) setTheme(t); } catch (e) {}

  buildCalStrip();
  renderDay(curDay);
  updateBellNub();
  if (window.buildProto) buildProto('member');
  lucide.createIcons();
  fit();
});
