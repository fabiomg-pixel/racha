// Supabase de mentira, em memória, pra exercitar as telas logadas sem conta real.
// Usado só por test/harness.html (import map troca js/db.js por este arquivo). Imita o RLS no que importa:
// myGroups devolve uma linha por MEMBRO (como o servidor), e create/update recusam somas que não batem.
const S = (window.__FAKE = window.__FAKE || { user: { id: "uF", email: "fabio@teste.dev" }, profiles: { uF: { id: "uF", name: "fabio", pix_key: null, pix_name: null } },
  groups: [], members: [], expenses: [], settlements: [], n: 0, calls: [], listeners: [] });
const id = p => p + (++S.n);
const now = () => new Date(Date.UTC(2026, 9, 10, 12, 0, S.n)).toISOString();
const log = (name, arg) => S.calls.push([name, arg]);
const ping = () => setTimeout(() => S.listeners.forEach(f => f()), 20);
const check = p => {
  const sum = a => Math.round((a || []).reduce((t, x) => t + Number(x.amount), 0) * 100);
  if(Math.abs(sum(p.payers) - Math.round(p.total * 100)) > 1) throw new Error("pagadores não somam o total");
  if(Math.abs(sum(p.shares) - Math.round(p.total * 100)) > 1) throw new Error("rateio não soma o total");
};
export const normalizeSupabaseUrl = u => u;
export const getSbConfig = () => ({ url: "https://fake.supabase.co", anon: "x" });
export const setSbConfig = () => {};
export const hasConfig = () => true;
export const init = async () => {};
export const currentUser = async () => S.user;
export const onAuthChange = cb => { S.auth = cb; };
export const sendMagicLink = async () => {};
export const verifyCode = async () => {};
export const signOut = async () => { S.user = null; };
export const getMyProfile = async () => (S.user ? S.profiles[S.user.id] : null);
export const saveProfile = async patch => { log("saveProfile", patch); return Object.assign(S.profiles[S.user.id], patch); };
export const myGroups = async () => S.members.filter(m => S.members.some(x => x.group_id === m.group_id && x.user_id === S.user.id)).map(m => S.groups.find(g => g.id === m.group_id)).filter(Boolean)
  .filter((g, i, a) => a.indexOf(g) === i);
export const createGroup = async (name, kind = "group") => { const g = { id: id("g"), name, kind, currency: "BRL", created_by: S.user.id, created_at: now() }; S.groups.push(g);
  S.members.push({ id: id("m"), group_id: g.id, user_id: S.user.id, display_name: S.profiles[S.user.id].name || "Eu", role: "admin" }); log("createGroup", { name, kind }); return g; };
export const createFriend = async name => { const g = await createGroup(name, "friend"); await addGhost(g.id, name); return g; };
export const renameGroup = async (gid, name) => { S.groups.find(g => g.id === gid).name = name; };
export const deleteGroup = async gid => { S.groups = S.groups.filter(g => g.id !== gid); S.members = S.members.filter(m => m.group_id !== gid); S.expenses = S.expenses.filter(e => e.group_id !== gid); };
export const groupMembers = async gid => S.members.filter(m => m.group_id === gid).sort((a, b) => a.display_name.localeCompare(b.display_name));
export const addGhost = async (gid, name) => { const m = { id: id("m"), group_id: gid, user_id: null, display_name: name, role: "member" }; S.members.push(m); return m; };
export const renameMember = async (mid, name) => Object.assign(S.members.find(m => m.id === mid), { display_name: name });
export const removeMember = async mid => { S.members = S.members.filter(m => m.id !== mid); };
export const groupNameOf = async gid => S.groups.find(g => g.id === gid)?.name;
export const ghostsOf = async gid => S.members.filter(m => m.group_id === gid && !m.user_id);
export const joinGroup = async (gid, claim) => { const m = S.members.find(x => x.id === claim); if(m) m.user_id = S.user.id; };
export const ledgerExpenses = async gid => S.expenses.filter(e => e.group_id === gid);
export const listExpenses = ledgerExpenses;
export const getExpense = async eid => S.expenses.find(e => e.id === eid);
export const groupExport = ledgerExpenses;
export const saveExpense = async p => { check(p); log("create_expense", p); const e = { ...p, id: id("e"), created_at: now() }; S.expenses.push(e); ping(); return e.id; };
export const updateExpense = async p => { check(p); log("update_expense", p); Object.assign(S.expenses.find(e => e.id === p.id), p); ping(); return p.id; };
export const deleteExpense = async eid => { log("deleteExpense", eid); S.expenses = S.expenses.filter(e => e.id !== eid); ping(); };
export const groupActivity = async () => [];
export const expenseComments = async () => [];
export const addComment = async () => {};
export const deleteComment = async () => {};
export const subscribeGroup = (gid, fn) => { S.listeners.push(fn); return { fn }; };
export const unsubscribe = ch => { S.listeners = S.listeners.filter(f => f !== ch?.fn); };
export const balances = async () => [];
export const listSettlements = async gid => S.settlements.filter(x => x.group_id === gid);
export const addSettlement = async ({ groupId, from, to, amount, settledAt }) => { const x = { id: id("s"), group_id: groupId, from_member: from, to_member: to, amount, settled_at: settledAt || now() }; log("addSettlement", x); S.settlements.push(x); ping(); return x; };
export const deleteSettlement = async sid => { log("deleteSettlement", sid); S.settlements = S.settlements.filter(x => x.id !== sid); ping(); };
export const memberPix = async uid => S.profiles[uid] || null;
