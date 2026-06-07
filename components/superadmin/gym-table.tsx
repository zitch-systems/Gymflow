// Shared platform gym table (used on overview + gyms). Static prototype data.
const GYMS = [
  { i: 'P', grad: 'linear-gradient(135deg,#11d18b,#07a86c)', name: 'Powerhouse Fitness', sub: 'powerhouse.gymflow.ng · Lagos', plan: 'Scale', members: 482, st: ['gf-badge-success', 'Active'], mrr: '₦119,999' },
  { i: 'F', grad: 'linear-gradient(135deg,#4080ff,#2a5cc0)', name: 'FlexZone', sub: 'flexzone.gymflow.ng · Abuja', plan: 'Growth', members: 318, st: ['gf-badge-success', 'Active'], mrr: '₦37,999' },
  { i: 'I', grad: 'linear-gradient(135deg,#a8d92e,#6a9c00)', name: 'IronWorks Gym', sub: 'ironworks.gymflow.ng · PH', plan: 'Scale', members: 540, st: ['gf-badge-success', 'Active'], mrr: '₦119,999' },
  { i: 'F', grad: 'linear-gradient(135deg,#ffb020,#cc8a10)', name: 'FitHub Enugu', sub: 'fithub.gymflow.ng · Enugu', plan: 'Growth', members: 206, st: ['gf-badge-danger', 'Past due'], mrr: '₦37,999' },
  { i: 'P', grad: 'linear-gradient(135deg,#b67bf3,#7c45c0)', name: 'Peak Fitness', sub: 'peak.gymflow.ng · Kaduna', plan: 'Starter', members: 74, st: ['gf-badge-warning', 'Trial'], mrr: '₦13,999' },
  { i: 'S', grad: 'linear-gradient(135deg,#11d18b,#4080ff)', name: 'Summit Fitness', sub: 'summit.gymflow.ng · Ibadan', plan: 'Growth', members: 291, st: ['gf-badge-success', 'Active'], mrr: '₦37,999' },
];

export function GymTable() {
  return (
    <table className="gt">
      <thead><tr><th>Gym</th><th>Plan</th><th>Members</th><th>Status</th><th style={{ textAlign: 'right' }}>MRR</th></tr></thead>
      <tbody>
        {GYMS.map((g, i) => (
          <tr key={i}>
            <td>
              <div className="gname">
                <span className="sq" style={{ background: g.grad }}>{g.i}</span>
                <div><strong>{g.name}</strong><small>{g.sub}</small></div>
              </div>
            </td>
            <td>{g.plan}</td>
            <td>{g.members}</td>
            <td><span className={`gf-badge ${g.st[0]}`}><span className="gf-dot" />{g.st[1]}</span></td>
            <td className="naira" style={{ textAlign: 'right' }}>{g.mrr}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
