// === app.js === 
// Client-side for FANTALEMONADA draft app
// Requires: socket.io client lib loaded on the page
// Assumes HTML elements with the IDs used below exist.

const socket = io();

// ---------- DOM elements ----------
const body = document.body;
const root = document.documentElement;

const pauseBtn = document.getElementById('pauseBtn') || document.getElementById('pauseResumeBtn');
const adminPassInput = document.getElementById('adminPass') || document.getElementById('adminPassword');
const adminBtn = document.getElementById('adminBtn') || document.getElementById('adminLoginBtn');
const timerSelect = document.getElementById('timerSelect');
const timerDisplay = document.getElementById('timer');
const currentTeamDisplay = document.getElementById('currentTeam') || document.getElementById('currentTeamName');

const teamPasswordContainer = document.getElementById('teamPasswordContainer');
const teamPasswordInput = document.getElementById('teamPasswordInput');
const teamPasswordSubmit = document.getElementById('teamPasswordSubmit');

const exportBtn = document.getElementById('exportCSV');
const teamSelect = document.getElementById('teamSelect');
const teamPassword = document.getElementById('teamPassword');
const viewTeamSelect = document.getElementById('viewTeamSelect') 
const draftBoardEl = document.getElementById('draftBoard');
const playersTableBody = document.querySelector('#playersTable tbody') || document.querySelector('#playerBoard tbody');
const playersTable = document.getElementById('playersTable');
const searchInput = document.getElementById('search');
const filterPosition = document.getElementById('filterPosition');
const filterTeam = document.getElementById('filterTeam');
const sortBy = document.getElementById('sortBy') || document.querySelector('[data-sort]') || null;
const teamDraftTableBody = document.querySelector('#teamDraftTable tbody') || document.querySelector('#teamDraftTable')?.querySelector('tbody');
const pickModal = document.getElementById('pickModal');
const modalText = document.getElementById('modalText');
const confirmPickBtn = document.getElementById('confirmPickBtn');
const cancelPickBtn = document.getElementById('cancelPickBtn');
const watchlistFilter = document.getElementById('watchlistFilter')
const ROSTER_LIMITS = { FWD: 6, MID: 8, DEF: 8, GK: 3 };


// ---------- State ----------
let draftPicks = [];
let availablePlayers = [];
let currentPickIndex = 0;
let isAdmin = false;
let yourTeam = '';  // start with no team selected
localStorage.removeItem('fanta_team'); // optional: clear previous selection
let pendingPick = null;
let lastSort = 'default';
let watchlist = {};
let showWatchlistOnly = false;





socket.on('onClock', () => {
  body.classList.remove('on-deck');
  body.classList.add('on-clock');
  
});

socket.on('onDeck', () => {
  body.classList.remove('on-clock');
  body.classList.add('on-deck');
 
});

socket.on('resetBackground', () => {
  body.classList.remove('on-clock', 'on-deck');

});

socket.on('connect', () => {
  console.log('Connected to server');
});


socket.on('init', (data) => {
  console.log('INIT DATA RECEIVED:', data); // debug
  draftPicks = data.draftPicks || [];
  availablePlayers = data.availablePlayers || [];
  currentPickIndex = data.currentPickIndex || 0;

  console.log('Available players:', availablePlayers); // debug



  

 const teamNames = Array.from(new Set(draftPicks.map(p => p.team))).filter(Boolean);
if (teamNames.length) {
  populateTeamSelects(teamNames);
  initTeamCounts(teamNames);
  rebuildTeamCounts(); // <-- ADD THIS LINE

}


  // ---------- FILTER TEAM OPTIONS ----------
  if (filterTeam) {
    const existing = new Set((availablePlayers || []).map(p => p.team).filter(Boolean));
    filterTeam.innerHTML = '<option value="">All Teams</option>';
    Array.from(existing).sort().forEach(t => {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      filterTeam.appendChild(o);
    });
  }

  renderDraftBoard();
  renderPlayersTable();
  renderTeamDraftTable(yourTeam);
});
// --- Add the updateDraft listener here ---
socket.on('updateDraft', (data) => {
  draftPicks = data.draftPicks;
  availablePlayers = data.availablePlayers;
  currentPickIndex = data.currentPickIndex;
  window._teamCounts = data.teamRosterCounts || window._teamCounts;
  rebuildTeamCounts();
  
  renderDraftBoard();
  renderPlayersTable();
});
socket.on('watchlistUpdated', (updatedWatchlists) => {
  // Overwrite local watchlist state
  watchlist = updatedWatchlists;

  // Re-render player table to update star icons
  renderPlayersTable();
});


socket.on('timerUpdate', ({ remainingSeconds }) => {
  if (timerDisplay) {
    timerDisplay.textContent = formatTime(remainingSeconds);
    if (remainingSeconds <= 10) timerDisplay.style.color = 'white';
    else timerDisplay.style.color = '';
  }
});

socket.on('adminResult', ({ success }) => {
  if (success) {
    isAdmin = true;
    alert('Admin login successful — admin controls enabled.');
    if (adminPassInput) { adminPassInput.value = ''; adminPassInput.placeholder = 'Admin (logged in)'; }
    if (timerSelect) timerSelect.disabled = false;
  } else {
    alert('Admin password incorrect.');
  }
});
socket.on('teamSelectionResult', ({ success, teamName }) => {
  if (!success) {
    alert(`Incorrect password for team "${teamName}". Select your team again.`);
    yourTeam = '';
    if (teamSelect) teamSelect.value = '';
  } else {
    alert(`Team "${teamName}" selected successfully!`);
    yourTeam = teamName;
    renderDraftBoard();
    renderTeamDraftTable(yourTeam);
  }
});


socket.on('draftEnded', (finalPicks) => {
  alert('Draft ended');
  draftPicks = finalPicks || draftPicks;
  renderDraftBoard();
  renderTeamDraftTable(yourTeam);
});

// ---------- UI Helpers ----------
function formatTime(sec) {
  if (sec < 0) sec = 0;
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function downloadCSV(filename, rows) {
  const csvContent = rows.map(r => {
    const vals = [r.round, r.pick, r.team, r.player || '' ].map(v=>{
      const s = String(v || '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g,'""')}"`;
      return s;
    });
    return vals.join(',');
  }).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function loadWatchlist(team) {
  const stored = localStorage.getItem(`watchlist_${team}`);
  if (stored) {
    try { watchlist[team] = JSON.parse(stored); } catch(e){ watchlist[team] = []; }
  } else { watchlist[team] = []; }
}

function saveWatchlist(team) {
  localStorage.setItem(`watchlist_${team}`, JSON.stringify(watchlist[team]));
}
function normalizePos(pos) {
  if (!pos) return '';
  const p = String(pos).toUpperCase();
  if (p.startsWith('F')) return 'FWD';
  if (p.startsWith('M')) return 'MID';
  if (p.startsWith('D')) return 'DEF';
  if (p.startsWith('G')) return 'GK';
  return p;
}
function initTeamCounts(teamNames) {
  window._teamCounts = {};
  teamNames.forEach(name => {
    window._teamCounts[name] = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  });
}
function rebuildTeamCounts() {
  window._teamCounts = {};
  draftPicks.forEach(p => {
    if (p.player && p.player !== 'skipped') incrementTeamPosCount(p.team, p.position);
  });
}

// Can this team draft another player of this position?
function canTeamDraftPosition(teamName, pos) {
  const P = normalizePos(pos);
  if (!window._teamCounts) window._teamCounts = {};
  if (!window._teamCounts[teamName]) window._teamCounts[teamName] = { FWD: 0, MID: 0, DEF: 0, GK: 0 };
  return (window._teamCounts[teamName][P] ?? 0) < (ROSTER_LIMITS[P] ?? Infinity);
}

function incrementTeamPosCount(teamName, pos) {
  const P = normalizePos(pos);
  if (!window._teamCounts) window._teamCounts = {};
  if (!window._teamCounts[teamName]) window._teamCounts[teamName] = { FWD: 0, MID: 0, DEF: 0, GK: 0 };
  window._teamCounts[teamName][P] = (window._teamCounts[teamName][P] ?? 0) + 1;
}

function decrementTeamPosCount(teamName, pos) {
  const P = normalizePos(pos);
  if (!window._teamCounts?.[teamName]) return;
  window._teamCounts[teamName][P] = Math.max(0, (window._teamCounts[teamName][P] ?? 0) - 1);
}


// ---------- Rendering ----------
function renderDraftBoard() {
  if (!draftBoardEl) return;
  draftBoardEl.innerHTML = '';
  draftPicks.forEach((pick, idx)=>{
    const row = document.createElement('div');
    row.className = 'draft-row';
    if (pick.team === yourTeam) row.classList.add('yourPick');
    if (idx === currentPickIndex) row.classList.add('current');
    
    const pickno = document.createElement('div'); pickno.className='pickno'; pickno.textContent=`${pick.round}.${pick.pick}`;
    const team = document.createElement('div'); team.className='team'; team.textContent=pick.team;
    const player = document.createElement('div'); player.className='player';
    if (pick.player==='skipped') player.innerHTML=`<span class="skipped">SKIPPED</span>`;
    else player.textContent = pick.player || '---';

    row.appendChild(pickno); row.appendChild(team); row.appendChild(player);

    row.addEventListener('click', ()=>{
      if (!isAdmin) return;
      if (idx < currentPickIndex && pick.player && pick.player!=='skipped') {
        const change = confirm(`Admin: change pick ${pick.round}.${pick.pick} (${pick.team})? Current: ${pick.player||'---'}`);
        if (!change) return;
        const newPlayer = prompt('Enter new player name (exact):');
        if (newPlayer) socket.emit('forceUpdatePick', { index: idx, player: newPlayer });
        return;
      }
      if (pick.player==='skipped' || !pick.player) {
        const newPlayer = prompt(`Admin: Enter player for ${pick.team} (round ${pick.round} pick ${pick.pick})`);
        if (newPlayer) socket.emit('forceUpdatePick', { index: idx, player: newPlayer });
      }
    });

    draftBoardEl.appendChild(row);
  });

  const currentEl = draftBoardEl.querySelector('.draft-row.current');
  if (currentEl) currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const currentPick = draftPicks[currentPickIndex];
  currentTeamDisplay.textContent = currentPick ? currentPick.team : '—';
}

function renderPlayersTable() {
  if (!playersTableBody) return;
  let list = availablePlayers.slice();
  const pos = filterPosition ? filterPosition.value : '';
  const teamF = filterTeam ? filterTeam.value : '';
  const search = searchInput ? searchInput.value.trim().toLowerCase() : '';

  if (watchlistFilter && watchlistFilter.value === 'watchlist' && yourTeam) {
  showWatchlistOnly = true;   // ✅ track that we are in watchlist mode
  loadWatchlist(yourTeam);
  const teamWatchlist = watchlist[yourTeam] || [];
  // Preserve click order: map watchlist names to player objects
  list = teamWatchlist
    .map(name => availablePlayers.find(p => p.player === name))
    .filter(Boolean); // remove any missing players
} else {
  showWatchlistOnly = false;
}



  if (pos) list = list.filter(p => (p.position||'').toLowerCase()===pos.toLowerCase());
  if (teamF) list = list.filter(p => (p.team||'').toLowerCase()===teamF.toLowerCase());
  if (search) list = list.filter(p => (p.player||'').toLowerCase().includes(search));

  if (showWatchlistOnly && yourTeam) {
    loadWatchlist(yourTeam);
    const teamWatchlist = watchlist[yourTeam] || [];
    list = list.filter(p => teamWatchlist.includes(p.player));
  }

 if (!showWatchlistOnly) { // only sort if not in watchlist-only
  if (lastSort==='player') list.sort((a,b)=> (a.player||'').localeCompare(b.player||''));
  else if (lastSort==='team') list.sort((a,b)=> (a.team||'').localeCompare(b.team||'') || (a.player||'').localeCompare(b.player||''));
  else if (lastSort==='position') list.sort((a,b)=> (a.position||'').localeCompare(b.position||'') || (a.player||'').localeCompare(b.player||''));
}

  playersTableBody.innerHTML = '';
  list.forEach(player=>{
    const tr = document.createElement('tr');
    const tdPos=document.createElement('td'); tdPos.textContent=player.position||'';
    const tdName=document.createElement('td'); tdName.textContent=player.player||'';
    const tdTeam=document.createElement('td'); tdTeam.textContent=player.team||'';

    // Watchlist star
const star = document.createElement('span');
star.textContent = '★';
star.style.cursor = 'pointer';
star.style.color = (yourTeam && watchlist[yourTeam]?.includes(player.player)) ? 'grey' : 'transparent';
star.style.transition = 'color 0.2s';
star.style.userSelect = 'none';

star.addEventListener('mouseenter', () => {
  if (!yourTeam) return;
  if (!watchlist[yourTeam]?.includes(player.player)) star.style.color = 'grey';
});
star.addEventListener('mouseleave', () => {
  if (!yourTeam) return;
  // ✅ Keep it grey if it's in the watchlist, otherwise transparent
  star.style.color = watchlist[yourTeam]?.includes(player.player) ? 'grey' : 'transparent';
});

star.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!yourTeam) { alert('Select your team to manage watchlist'); return; }
  loadWatchlist(yourTeam);
  if (!watchlist[yourTeam]) watchlist[yourTeam] = [];
  const idx = watchlist[yourTeam].indexOf(player.player);
  if (idx === -1) {
    watchlist[yourTeam].push(player.player);
    star.style.color = 'grey';
  } else {
    watchlist[yourTeam].splice(idx, 1);
    star.style.color = 'transparent';
  }

  // ✅ Save locally
  saveWatchlist(yourTeam);

  // ✅ Send updated watchlist to server
  socket.emit('updateWatchlist', { team: yourTeam, players: watchlist[yourTeam] });


  renderPlayersTable();
});


// Arrow container (up/down) only shows if player is in watchlist
const arrowContainer = document.createElement('span');
arrowContainer.style.marginLeft = '4px';

arrowContainer.style.display = 'inline-block';
arrowContainer.style.marginLeft = '4px';
arrowContainer.style.verticalAlign = 'middle';


// Only show arrows if "Watchlist Only" filter is active
// Only add arrows if we're in watchlist view AND the player is in this team's watchlist
if (showWatchlistOnly && yourTeam && watchlist[yourTeam]?.includes(player.player)) {
  const upBtn = document.createElement('button');
  upBtn.textContent = '▲';
  upBtn.style.fontSize = '10px';
  upBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = watchlist[yourTeam].indexOf(player.player);
    if (idx > 0) {
      [watchlist[yourTeam][idx - 1], watchlist[yourTeam][idx]] =
      [watchlist[yourTeam][idx], watchlist[yourTeam][idx - 1]];

      saveWatchlist(yourTeam);

      // 🔑 Tell the server about new order
      socket.emit('updateWatchlist', {
        team: yourTeam,
        players: watchlist[yourTeam]
      });

      renderPlayersTable();
    }
  });

  const downBtn = document.createElement('button');
  downBtn.textContent = '▼';
  downBtn.style.fontSize = '10px';
  downBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = watchlist[yourTeam].indexOf(player.player);
    if (idx < watchlist[yourTeam].length - 1) {
      [watchlist[yourTeam][idx + 1], watchlist[yourTeam][idx]] =
      [watchlist[yourTeam][idx], watchlist[yourTeam][idx + 1]];

      saveWatchlist(yourTeam);

      // 🔑 Tell the server about new order
      socket.emit('updateWatchlist', {
        team: yourTeam,
        players: watchlist[yourTeam]
      });

      renderPlayersTable();
    }
  });

  arrowContainer.appendChild(upBtn);
  arrowContainer.appendChild(downBtn);
}

// Append star and arrows to td, then row
const tdStar = document.createElement('td');
tdStar.appendChild(star);
tdStar.appendChild(arrowContainer);
tr.appendChild(tdStar);

    tr.appendChild(tdPos); tr.appendChild(tdName); tr.appendChild(tdTeam);

   tr.addEventListener('click', ()=>{
  const pick = draftPicks[currentPickIndex];
  if (!pick) { alert('Draft is finished or not initialized'); return; }
  if (!isAdmin && (!yourTeam || pick.team!==yourTeam)) { 
    alert(`You can only pick for your team when it's your turn. Your team: ${yourTeam||'none'}`); 
    return; 
  }

  // 🆕 enforce roster limit
  const ok = canTeamDraftPosition(pick.team, player.position);
  if (!ok) {
    alert(`Roster full at ${normalizePos(player.position)} for ${pick.team}.`);
    return;
  }

  const confirmed = confirm(`Pick ${player.player} for ${pick.team} (${pick.round}.${pick.pick})?`);
  if (confirmed) {
    socket.emit('makePick', { player: player.player });
    
  }
});

// disable row if roster full for your own team only
if (yourTeam && player.team === yourTeam && !canTeamDraftPosition(yourTeam, player.position)) {
  tr.style.opacity = '0.5';
  tr.style.pointerEvents = 'none';
}



    playersTableBody.appendChild(tr);
  });
}

function renderTeamDraftTable(team) {
  if (!teamDraftTableBody) return;
  teamDraftTableBody.innerHTML = '';
  if (!team) {
    const tr=document.createElement('tr'); const td=document.createElement('td'); td.colSpan=3; td.textContent='Select a team to view picks'; tr.appendChild(td); teamDraftTableBody.appendChild(tr); return;
  }
  const picks=draftPicks.filter(p=>p.team===team);
  picks.forEach(pick=>{
    const tr=document.createElement('tr');
    const tdPick=document.createElement('td'); tdPick.textContent=`${pick.round}.${pick.pick}`;
    const tdPosition = document.createElement('td'); tdPosition.textContent = pick.position || '';
    const tdPlayer=document.createElement('td'); tdPlayer.textContent=pick.player||'---';
  

    if (pick.player==='skipped') tdPlayer.innerHTML=`<span style="color:red;font-weight:700">SKIPPED</span>`;


    tr.appendChild(tdPick);
    tr.appendChild(tdPosition);
    tr.appendChild(tdPlayer);
  
    teamDraftTableBody.appendChild(tr);
  });
}

function resetTimerFromSelect() {
  if (!timerSelect) return;
  const secs = parseInt(timerSelect.value,10);
  if (!isNaN(secs)) timerDisplay.textContent=formatTime(secs);
}

// ---------- UI wiring ----------
function wireUI() {


  if (viewTeamSelect) {
    viewTeamSelect.addEventListener('change', (e)=>{ renderTeamDraftTable(e.target.value); });
  }
  if (teamSelect) {
  teamSelect.addEventListener('change', (e) => {
    yourTeam = e.target.value || '';
    localStorage.setItem('fanta_team', yourTeam);

   


    if (yourTeam) {
  if (teamPasswordContainer) teamPasswordContainer.style.display = 'inline-block';
  teamPasswordInput.value = '';
  teamPasswordInput.focus();
}

  });
}
if (teamPasswordSubmit) {
  teamPasswordSubmit.addEventListener('click', () => {
    const pw = teamPasswordInput?.value?.trim() || '';
    if (!yourTeam) {
      alert('Select your team first');
      return;
    }
    if (!pw) {
      alert('Enter your team password');
      return;
    }
    console.log('Selecting team:', yourTeam, 'with password:', pw); // DEBUG
    socket.emit('selectTeam', { teamName: yourTeam, password: pw });
  });
}


  if (adminBtn) {
  adminBtn.addEventListener('click', () => {
    const pass = adminPassInput?.value?.trim() || '';
    if (!pass) { alert('Enter admin password'); return; }
    socket.emit('adminLogin', { password: pass });
  });
}


  if (pauseBtn) {
    pauseBtn.addEventListener('click', ()=>{
      if (!isAdmin) { alert('Only admins can pause/resume the draft'); return; }
      if (pauseBtn.textContent.toLowerCase().includes('pause')) { socket.emit('pauseDraft'); pauseBtn.textContent='Resume Draft'; }
      else { socket.emit('resumeDraft'); pauseBtn.textContent='Pause Draft'; }
    });
  }

  if (timerSelect) {
    timerSelect.addEventListener('change', ()=>{
      if (!isAdmin) { alert('Only admins can change the timer'); return; }
      const secs=parseInt(timerSelect.value,10);
      if(!isNaN(secs)) socket.emit('setTimer',secs);
    });
  }

  if (exportBtn) exportBtn.addEventListener('click', ()=>{
    if (!draftPicks || !draftPicks.length) { alert('No draft data to export'); return; }
    const now=new Date();
    const fname=`fantalemonada_draft_${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}.csv`;
    downloadCSV(fname,draftPicks);
  });

  if (searchInput) searchInput.addEventListener('input', ()=>renderPlayersTable());
  if (filterPosition) filterPosition.addEventListener('change', ()=>renderPlayersTable());
  if (filterTeam) filterTeam.addEventListener('change', ()=>renderPlayersTable());
  if (watchlistFilter) {
  watchlistFilter.addEventListener('change', () => renderPlayersTable());
}

  if (sortBy) sortBy.addEventListener('change',(e)=>{ lastSort=e.target.value||'default'; renderPlayersTable(); });


}

// ---------- Populate team selects ----------
function populateTeamSelects(teamNames) {
  if (!teamNames||!teamNames.length) return;
  const selpts=[teamSelect, viewTeamSelect];
  selpts.forEach(sel=>{
    if (!sel) return;
    const placeholder = sel.querySelector('option[value=""]') ? sel.querySelector('option[value=""]').outerHTML : '<option value="">--Choose Team--</option>';
    sel.innerHTML=placeholder;
    teamNames.forEach(t=>{ const opt=document.createElement('option'); opt.value=t; opt.textContent=t; sel.appendChild(opt); });
  });
  if (teamSelect && yourTeam) teamSelect.value=yourTeam;
  if (viewTeamSelect && yourTeam) viewTeamSelect.value=yourTeam;
}

document.addEventListener('DOMContentLoaded', () => {
  wireUI(); // already handles all team/admin wiring correctly
});


// ---------- Debug API ----------
window.FANTASY = {
  getState: ()=>({ draftPicks, availablePlayers, currentPickIndex, yourTeam, isAdmin })
};
