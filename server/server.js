// server.js - FANTALEMONADA draft server
// Node.js + Express + Socket.IO
// Requires: npm install express socket.io csv-parser dotenv

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

// map socket.id -> team name selected by that socket
const socketTeams = new Map();


const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 4000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Example: each team has a password
const teamPasswords = {
  'FC Wyoming': "101",
  'ASS Rint oCess': "837",
  'Real Boban': "483",
  'LI Mutanda': "731",
  'Vostri Cavani': "861",
  'Paris San Gennaro': "938",
  'Stamm Nguaiat FC': "581",
  'AutoDraft FC' : "797",
  'Chunky Lozano': "378",
  'Cioccolato Bianco': "982",
  'Alessandro FC': "362",
  'SSC Mario Rui': "796",
  // add all teams here
};

// Track which teams are currently taken
const activeTeams = {};


// ----- Configurable draft settings -----
const NUM_TEAMS = 12;
const NUM_ROUNDS = 25;

// Default draft order (edit this array in code to set draft order before starting)
let draftOrder = [
  'FC Wyoming','ASS Rint oCess','Real Boban','LI Mutanda','Vostri Cavani','Paris San Gennaro',
  'Stamm Nguaiat FC','AutoDraft FC','Chunky Lozano','Cioccolato Bianco','Alessandro FC','SSC Mario Rui'
];
// ---------------------------------------
// Max allowed per position per team
const maxPositions = { GK: 3, DEF: 8, MID: 8, FWD: 6 };


// Track current roster counts for each team
const teamRosterCounts = {};
draftOrder.forEach(team => {
  teamRosterCounts[team] = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
});

const watchlists = {
  'FC Wyoming': [],
  'ASS Rint oCess': [],
  'Real Boban': [],
  'LI Mutanda': [],
  'Vostri Cavani': [],
  'Paris San Gennaro': [],
  'Stamm Nguaiat FC': [],
  'AutoDraft FC': [],
  'Chunky Lozano': [],
  'Cioccolato Bianco': [],
  'Alessandro FC': [],
  'SSC Mario Rui': []
};




let draftPicks = [];        // { round, pick, team, player }
let availablePlayers = [];  // { position, player, team }
let currentPickIndex = 0;
let timerDuration = parseInt(process.env.TIMER_DEFAULT) || 120; // seconds
let timerHandle = null;
let isPaused = true;
let remainingSeconds = timerDuration; // counts down each second


// Track which sockets authenticated as admin
const adminSockets = new Set();

// Serve client static files (assumes client files in ./client)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Load players CSV into availablePlayers (filePath can be adjusted)
function loadCSV(filePath = path.join(__dirname, 'players.csv')) {
  availablePlayers = [];
  if (!fs.existsSync(filePath)) {
    console.log('players.csv not found at', filePath, '- availablePlayers remains empty.');
    return;
  }
  fs.createReadStream(filePath)
    .pipe(csv(['position','player','team']))
    .on('data', (row) => {
      availablePlayers.push({
        position: (row.position || '').trim(),
        player: (row.player || '').trim(),
        team: (row.team || '').trim()
      });
    })
    .on('end', () => {
      console.log(`Loaded ${availablePlayers.length} players from ${filePath}`);

      // send INIT to all connected sockets now that CSV is ready
      io.sockets.sockets.forEach(sock => {
        sock.emit('init', {
          draftPicks,
          availablePlayers,
          currentPickIndex,
          timerDuration,
          isPaused
        });
      });
    });
}

// Initialize draftPicks array using snake order
function initializeDraft() {
  draftPicks = [];
  for (let round = 1; round <= NUM_ROUNDS; round++) {
    const forward = (round % 2 === 1);
    const teams = forward ? draftOrder.slice() : draftOrder.slice().reverse();
    teams.forEach((teamName, idx) => {
      draftPicks.push({
        round,
        pick: idx + 1,
        team: teamName,
        player: null
      });
    });
  }
  currentPickIndex = 0;
  isPaused = true;
  clearTimer();
}

function clearTimer() {
  if (timerHandle) {
    clearInterval(timerHandle); // use clearInterval since startServerTimer uses setInterval
    timerHandle = null;
  }
}


function startServerTimer() {
  clearTimer();
  if (isPaused) return;

  timerHandle = setInterval(() => {
    if (isPaused) {
      clearTimer();
      return;
    }

    remainingSeconds--;

    io.emit('timerUpdate', { remainingSeconds });

    if (remainingSeconds <= 0) {
      // Auto-draft the current pick
      autoDraftCurrentPick();

      // Reset timer for next pick
      remainingSeconds = timerDuration;

      // Broadcast update (optional, since autoDraftCurrentPick already does)
      broadcastUpdate();
    }
  }, 1000);
}

function advanceToNextPick() {
  currentPickIndex++;
  if (currentPickIndex >= draftPicks.length) {
    clearTimer();
    io.emit('draftEnded', draftPicks);
    return;
  }
  remainingSeconds = timerDuration; // reset for next pick
  broadcastUpdate();
   // ----- Background color alerts -----
  const currentTeam = draftPicks[currentPickIndex]?.team;
  const nextPick = draftPicks[currentPickIndex + 1];
  const nextTeam = nextPick ? nextPick.team : null;

  for (let [socketId, teamName] of socketTeams.entries()) {
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) continue;

  if (teamName === currentTeam) {
    socket.emit('onClock');     // your turn
  } else if (teamName && teamName === nextTeam) {
    socket.emit('onDeck');      // next up
  } else {
    socket.emit('resetBackground'); // everyone else
  }
}

  
  if (!isPaused) startServerTimer();
}


// Broadcast current state to all clients
function broadcastUpdate() {
  io.emit('updateDraft', {
    draftPicks,
    availablePlayers,
    currentPickIndex,
    timerDuration,
    isPaused,
    teamRosterCounts
  });
}


// Validate admin (socket must have logged in)
function isSocketAdmin(socket) {
  return adminSockets.has(socket.id);
}

// ----- Socket.IO handlers -----
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  
// Emit INIT immediately on new connection
socket.emit('init', {
  draftPicks,
  availablePlayers,
  currentPickIndex,
  timerDuration,
  isPaused,
  watchlists 
});

// Update a team's watchlist from client
socket.on('updateWatchlist', ({ team, players }) => {
  if (!team || !Array.isArray(players)) return;

  // Overwrite server-side watchlist
  watchlists[team] = players.slice();

  // Broadcast updated watchlists to all clients
  io.emit('watchlistsUpdated', watchlists);
});



  // Store which team this socket controls
socket.on("selectTeam", ({ teamName, password }) => {
  // Check if password matches
 if (teamPasswords[teamName] !== password) {
  socket.emit("teamSelectionResult", { success: false, teamName });
  return;
 }


  // Assign team to this socket
  socket.team = teamName;
  activeTeams[teamName] = socket.id;

  
  
  socketTeams.set(socket.id, teamName);
   // ✅ Notify client of success
  socket.emit('teamSelectionResult', { success: true, teamName });

});


  

socket.on('makePick', (payload) => {
  try {
    if (!draftPicks[currentPickIndex]) return;

    const playerName = payload && payload.player ? payload.player : null;
    const pickingTeam = draftPicks[currentPickIndex].team;
    const socketTeam = socketTeams.get(socket.id) || socket.team;

    // Only allow pick if admin OR the socket's team matches the current pick
    if (!isSocketAdmin(socket) && socketTeam !== pickingTeam) {
      socket.emit('error', 'not_your_turn');
      return;
    }

   
 const pickedPlayer = availablePlayers.find(p => p.player === playerName);
const pos = pickedPlayer?.position;

// Check if the position is already full
if (pos && teamRosterCounts[pickingTeam][pos] >= maxPositions[pos]) {
  socket.emit('error', 'roster_full');  // pick invalid
  return;
}

// Increment roster count for valid pick
if (pickedPlayer && pickedPlayer.position) {
  teamRosterCounts[pickingTeam][pickedPlayer.position]++;
}


  draftPicks[currentPickIndex] = {
  ...draftPicks[currentPickIndex],  // preserve round & team
  player: playerName,
  position: pickedPlayer ? pickedPlayer.position : '',
  playerTeam: pickedPlayer ? pickedPlayer.team : ''
};

  
  // Remove from availablePlayers
  availablePlayers = availablePlayers.filter(p => p.player !== playerName);



      broadcastUpdate();
      // Move to next pick
      advanceToNextPick();
    } catch (err) {
      console.error('makePick error:', err);
    }
  });

  // Admin: force update a specific pick index with player
  // payload: { index, player }
socket.on('forceUpdatePick', (payload) => {
  if (!isSocketAdmin(socket)) {
    socket.emit('adminResult', { success: false, message: 'Not admin' });
    return;
  }
  const { index, player } = payload || {};
  if (typeof index !== 'number' || index < 0 || index >= draftPicks.length) return;

  const oldPick = draftPicks[index];

  // If there was a previous player, decrement and return them to availablePlayers
  if (oldPick?.player && oldPick.position) {
    teamRosterCounts[oldPick.team][oldPick.position] = Math.max(0, teamRosterCounts[oldPick.team][oldPick.position] - 1);

    // Return old player to the available pool (avoid duplicates)
    const alreadyAvailable = availablePlayers.some(p => p.player === oldPick.player);
    if (!alreadyAvailable) {
      availablePlayers.push({
        position: oldPick.position || '',
        player: oldPick.player || '',
        team: oldPick.playerTeam || ''
      });
    }
  }

  if (player) {
    // Apply the new player
    const pickedPlayer = availablePlayers.find(p => p.player === player);

    draftPicks[index] = {
      ...draftPicks[index],
      player: player,
      position: pickedPlayer ? pickedPlayer.position : '',
      playerTeam: pickedPlayer ? pickedPlayer.team : ''
    };

    if (pickedPlayer && pickedPlayer.position) {
      teamRosterCounts[draftPicks[index].team][pickedPlayer.position]++;
    }

    // Remove from availability
    availablePlayers = availablePlayers.filter(p => p.player !== player);
  } else {
    // Clear the pick completely
    draftPicks[index] = {
      ...draftPicks[index],
      player: null,
      position: '',
      playerTeam: ''
    };
  }

  broadcastUpdate();
 
});


  // Admin: pause
 socket.on('pauseDraft', () => {
  if (!isSocketAdmin(socket)) { socket.emit('error', 'not_admin'); return; }
  isPaused = true;
  clearTimer(); // stops the interval'
  io.emit('updateDraft', { draftPicks, availablePlayers, currentPickIndex, timerDuration, isPaused, teamRosterCounts });

}); 

  // Admin: resume
 socket.on('resumeDraft', () => {
  if (!isSocketAdmin(socket)) { socket.emit('error', 'not_admin'); return; }
  if (!isPaused) return;
  isPaused = false;
  io.emit('updateDraft', { draftPicks, availablePlayers, currentPickIndex, timerDuration, isPaused, teamRosterCounts });

  startServerTimer();
});

  // Admin: set timer duration (seconds)
  socket.on('setTimer', (seconds) => {
    if (!isSocketAdmin(socket)) { socket.emit('error', 'not_admin'); return; }
    const s = parseInt(seconds, 10);
    if (!isNaN(s) && s > 0) {
      timerDuration = s;
      // restart server timer for current pick if not paused
      if (!isPaused) {
        startServerTimer();
      }
      io.emit('updateDraft', { draftPicks, availablePlayers, currentPickIndex, timerDuration, isPaused, teamRosterCounts });

    }
  });

  // Admin login: payload { password }
  socket.on('adminLogin', (payload) => {
    const pass = payload && payload.password ? String(payload.password) : '';
    if (pass === ADMIN_PASSWORD) {
      adminSockets.add(socket.id);
      socket.emit('adminResult', { success: true });
      console.log('Admin logged in:', socket.id);
    } else {
      socket.emit('adminResult', { success: false });
    }
  });

  // Allow upload of players via socket (optional)
  // payload: players array [{position,player,team},...]
  socket.on('uploadCSV', (players) => {
    if (Array.isArray(players)) {
      availablePlayers = players.map(p => ({
        position: p.position ? String(p.position).trim() : '',
        player: p.player ? String(p.player).trim() : '',
        team: p.team ? String(p.team).trim() : ''
      }));
      io.emit('updateDraft', { draftPicks, availablePlayers, currentPickIndex, timerDuration, isPaused, teamRosterCounts });

    }
  });

socket.on('disconnect', () => {
  adminSockets.delete(socket.id);
  console.log('Socket disconnected:', socket.id);

  if (socket.team && activeTeams[socket.team] === socket.id) {
    delete activeTeams[socket.team];
  }

  socketTeams.delete(socket.id);
});
});
function autoDraftCurrentPick() {
  const pick = draftPicks[currentPickIndex];
  if (!pick) return;

  const team = pick.team;
  const roster = teamRosterCounts[team];

  const teamWatchlist = watchlists[team] || [];

  // Try watchlist first
  let playerName = teamWatchlist.find(pName => {
    const p = availablePlayers.find(ap => ap.player === pName);
    return p && roster[p.position] < maxPositions[p.position];
  });

  // If none, pick first available
  if (!playerName) {
    const available = availablePlayers.find(p => {
      const pos = p.position;
      return pos && roster[pos] < maxPositions[pos];
    });
    playerName = available ? available.player : null;
  }

  if (!playerName) {
    advanceToNextPick();
    return;
  }

  const pickedPlayer = availablePlayers.find(p => p.player === playerName);
  if (!pickedPlayer) {
    advanceToNextPick();
    return;
  }

  draftPicks[currentPickIndex] = {
    ...draftPicks[currentPickIndex],
    player: pickedPlayer.player,
    position: pickedPlayer.position,
    playerTeam: pickedPlayer.team
  };

  roster[pickedPlayer.position]++;
  availablePlayers = availablePlayers.filter(p => p.player !== playerName);
  broadcastUpdate();
  advanceToNextPick();
}



// --------- startup ----------
initializeDraft();
loadCSV(); // default path ./players.csv

// Optionally start timer automatically (commented out so admin can resume manually if desired)
// isPaused = false; startServerTimer();

server.listen(PORT, () => {
  console.log(`FANTALEMONADA server listening on port ${PORT}`);
});
