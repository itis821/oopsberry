import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import { getDatabase, ref, set, get, update, onValue, off, push, remove, onDisconnect, runTransaction } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js';

const firebaseConfig = { apiKey: 'AIzaSyCO6d8xemPjvrd4_twdiouZ4vG-AlFiexo', authDomain: 'drawdrawonthewall.firebaseapp.com', databaseURL: 'https://drawdrawonthewall-default-rtdb.asia-southeast1.firebasedatabase.app', projectId: 'drawdrawonthewall', storageBucket: 'drawdrawonthewall.firebasestorage.app', messagingSenderId: '843622460328', appId: '1:843622460328:web:64e4cb2c8760a9e00d8b9d' };
const app = initializeApp(firebaseConfig), db = getDatabase(app), auth = getAuth(app);
const APP_VERSION = 'v8';
const COLORS = ['#f0f0e0', '#e63946', '#ff6b35', '#f4a261', '#f4d35e', '#2a9d8f', '#457b9d', '#9b5de5'];
const DEFAULT_WORDS = ['사과', '고양이', '학교', '축구공', '비행기', '나비', '수박', '로봇'];
const BANNED_PATTERNS = [
  /씨발|시발|쉬발|쉬벌|시벌|십팔|ㅅㅂ|ㅆㅂ|ㅅ\s*ㅂ/i,
  /병신|븅신|ㅂㅅ|ㅂ\s*ㅅ/i,
  /미친|ㅁㅊ|ㅁ\s*ㅊ|지랄|염병|개새|꺼져|존나|좆|좇/i,
  /섹스|ㅅㅅ|성기|자지|보지|야동|포르노|딸딸|음경|질|애무|가슴빨/i,
  /fuck|f\s*u\s*c\s*k|shit|bitch|sex|porn|dick|pussy/i,
  /보\s*지|자\s*지|씨\s*발|시\s*발|병\s*신/i,
  /[ㅂㅈ]{2,}|[ㅈㄹ]{2,}|[ㅅㅂ]{2,}/i
];

let myId = localStorage.getItem('gm_uid');
if (!myId) { myId = 'u_' + Math.random().toString(36).slice(2, 11); localStorage.setItem('gm_uid', myId); }

let myName = '', myRole = '', roomCode = '';
let roomRef, playersRef, gameRef, chatRef, canvasRef, settingsRef;
let timerInterval = null, listeners = {}, canvasEventsBound = false;
let isDrawer = false, drawing = false, erasing = false, brushSize = 8, brushColor = COLORS[0];
let undoStack = [], nextRoundScheduled = false, lastCelebrationKey = '', currentRoundSeen = 0;
let rulesCountdownTimer = null, audioCtx = null, soundEnabled = true, rulesShownForRoom = false;
let lastWrongPopupKey = '', lastDrawerTurnKey = '';
let playersCache = {};
let gameCache = {};

const canvas = document.getElementById('drawCanvas'), ctx = canvas.getContext('2d');

window.selectRole = selectRole;
window.showScreen = showScreen;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.startGame = startGame;
window.nextRound = nextRound;
window.submitAnswer = submitAnswer;
window.backToLobby = backToLobby;
window.clearCanvas = clearCanvas;
window.toggleEraser = toggleEraser;
window.undoCanvas = undoCanvas;
window.toggleSound = toggleSound;

async function ensureAnonymousAuth() {
  try {
    if (!auth.currentUser) await signInAnonymously(auth);
    myId = auth.currentUser?.uid || myId;
    localStorage.setItem('gm_uid', myId);
  } catch (e) {
    console.error(e);
    alert('익명 로그인에 실패했어. Firebase Authentication > Anonymous 설정을 확인해줘.');
  }
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function toast(msg) { alert(msg); }

function todayKey() { return new Date().toISOString().slice(0, 10).replace(/-/g, ''); }

function showCenterPopup(title, sub, ms = 2200, tone = 'success') {
  const p = document.getElementById('centerPopup'),
    t = document.getElementById('centerPopupTitle'),
    s = document.getElementById('centerPopupSub');
  t.textContent = title;
  s.textContent = sub;
  p.style.borderColor = tone === 'fail' ? '#e63946' : '#ff8c42';
  t.style.color = tone === 'fail' ? '#e63946' : '#ff8c42';
  p.classList.remove('hidden');
  setTimeout(() => p.classList.add('hidden'), ms);
}

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}

function playTone(freq = 660, duration = .12, type = 'sine', gainValue = .05) {
  if (!soundEnabled) return;
  try {
    ensureAudio();
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = gainValue;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) { console.error(e); }
}

function playCorrectSound() {
  playTone(660, .08, 'triangle', .04);
  setTimeout(() => playTone(880, .1, 'triangle', .04), 90);
  setTimeout(() => playTone(1040, .12, 'triangle', .04), 200);
}

function playFailSound() {
  playTone(320, .14, 'sawtooth', .035);
  setTimeout(() => playTone(250, .18, 'sawtooth', .035), 120);
}

function showRulesOverlay() {
  const o = document.getElementById('rulesOverlay'), c = document.getElementById('rulesCountdown');
  let left = 20;
  c.textContent = left;
  o.classList.remove('hidden');
  rulesShownForRoom = true;
  if (rulesCountdownTimer) clearInterval(rulesCountdownTimer);
  rulesCountdownTimer = setInterval(() => {
    left -= 1;
    c.textContent = left;
    if (left <= 0) { clearInterval(rulesCountdownTimer); o.classList.add('hidden'); }
  }, 1000);
}

function normalizeForFilter(text) {
  return String(text || '').toLowerCase().replace(/[!@#$%^&*()_+=\-{}\[\]:;"'`,.<>/?\\|~]/g, '').replace(/\s+/g, '');
}

function sanitizeAnswer(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }

function containsBannedWord(text) {
  const n = normalizeForFilter(text);
  return BANNED_PATTERNS.some(rx => rx.test(n));
}

async function attachPresence(name) {
  const presRef = ref(db, `presence/${myId}`);
  await set(presRef, { name, ts: Date.now() });
  onDisconnect(presRef).remove();
  const userRef = ref(db, `stats/users/${myId}`), snap = await get(userRef), user = snap.val();
  if (!user?.firstSeen) await runTransaction(ref(db, 'stats/counters/totalUsers'), v => (v || 0) + 1);
  if (user?.lastDate !== todayKey()) await runTransaction(ref(db, `stats/counters/daily_${todayKey()}`), v => (v || 0) + 1);
  await update(userRef, { firstSeen: user?.firstSeen || Date.now(), lastDate: todayKey(), name });
}

function loadStats() {
  addListener('stat_presence', ref(db, 'presence'), snap => {
    document.getElementById('statOnline').textContent = Object.keys(snap.val() || {}).length;
  });
  addListener('stat_counters', ref(db, 'stats/counters'), snap => {
    const v = snap.val() || {};
    document.getElementById('statTotal').textContent = v.totalUsers || 0;
    document.getElementById('statToday').textContent = v[`daily_${todayKey()}`] || 0;
  });
}

function selectRole(role) {
  myRole = role;
  detachAllListeners();
  localStorage.removeItem('gm_session');
  roomCode = '';
  if (role === 'teacher') {
    showScreen('screenTeacherHome');
    loadStats();
  } else {
    showScreen('screenStudentHome');
    document.getElementById('studentName').value = '';
    document.getElementById('roomCodeInput').value = '';
  }
}

function initRefs() {
  roomRef = ref(db, `rooms/${roomCode}`);
  playersRef = ref(db, `rooms/${roomCode}/players`);
  gameRef = ref(db, `rooms/${roomCode}/game`);
  chatRef = ref(db, `rooms/${roomCode}/chat`);
  canvasRef = ref(db, `rooms/${roomCode}/canvas`);
  settingsRef = ref(db, `rooms/${roomCode}/settings`);
}

function addListener(key, targetRef, callback) {
  if (listeners[key]) off(listeners[key].targetRef, 'value', listeners[key].callback);
  onValue(targetRef, callback);
  listeners[key] = { targetRef, callback };
}

function detachAllListeners() {
  Object.values(listeners).forEach(({ targetRef, callback }) => off(targetRef, 'value', callback));
  listeners = {};
}

async function genUniqueRoomCode() {
  for (let i = 0; i < 15; i++) {
    const code = Math.random().toString(36).slice(2, 6).toUpperCase();
    const snap = await get(ref(db, `rooms/${code}/code`));
    if (!snap.exists()) return code;
  }
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function parseWords(raw) {
  const pieces = raw.split(/[,\n]/).map(v => v.trim()).filter(Boolean);
  return [...new Set(pieces)];
}

async function resolveUniqueName(code, desiredName) {
  const snap = await get(ref(db, `rooms/${code}/players`));
  const players = snap.val() || {};
  const mine = players[myId];
  if (mine) return mine.name || desiredName;
  const used = Object.values(players).map(p => p.name);
  if (!used.includes(desiredName)) return desiredName;
  let idx = 2;
  while (used.includes(`${desiredName}${idx}`)) idx++;
  return `${desiredName}${idx}`;
}

function getNextDrawer(players, usedDrawers) {
  const students = Object.entries(players).filter(([, p]) => p.role === 'student').map(([uid]) => uid);
  if (!students.length) return null;
  const usedSet = new Set(usedDrawers || []);
  let eligible = students.filter(uid => !usedSet.has(uid));
  if (!eligible.length) { eligible = [...students]; }
  return eligible.sort((a, b) => {
    const pa = (window.__playersCache?.[a] || players[a]), pb = (window.__playersCache?.[b] || players[b]);
    const da = pa?.drawCount || 0, db = pb?.drawCount || 0;
    if (da !== db) return da - db;
    return (pa?.joinedAt || 0) - (pb?.joinedAt || 0);
  })[0];
}

async function createRoom() {
  const teacherName = (document.getElementById('teacherName').value || '').trim() || '선생님',
    timeLimit = parseInt(document.getElementById('timeLimit').value, 10),
    words = parseWords(document.getElementById('wordInput').value || '');
  if (!words.length) { toast('제시어를 1개 이상 입력해줘.'); return; }
  soundEnabled = document.getElementById('soundSelect').value === 'on';
  myName = teacherName; myRole = 'teacher'; roomCode = await genUniqueRoomCode(); initRefs();
  await set(roomRef, { code: roomCode, host: myId, status: 'waiting', createdAt: Date.now(), appVersion: APP_VERSION });
  await set(playersRef, { [myId]: { name: teacherName, role: 'teacher', isManager: true, score: 0, drawCount: 0, correctCount: 0, joinedAt: Date.now() } });
  await set(settingsRef, { roundCount: words.length, timeLimit, words, appVersion: APP_VERSION });
  await set(gameRef, { status: 'waiting', round: 0, totalRounds: words.length, drawerId: '', keyword: '', timeLimit, timerStart: 0, answeredBy: '', usedWords: [], usedDrawers: [], roundOver: false });
  await set(canvasRef, { data: '', ts: Date.now() });
  localStorage.setItem('gm_session', JSON.stringify({ code: roomCode, name: myName, role: myRole, appVersion: APP_VERSION }));
  await attachPresence(myName);
  rulesShownForRoom = false;
  enterWaiting();
}

async function joinRoom() {
  const desiredName = (document.getElementById('studentName').value || '').trim(),
    code = (document.getElementById('roomCodeInput').value || '').trim().toUpperCase();
  if (!desiredName) return toast('이름을 입력해줘.');
  if (!code) return toast('방 코드를 입력해줘.');
  const roomSnap = await get(ref(db, `rooms/${code}`));
  if (!roomSnap.exists()) return toast('방을 찾을 수 없어.');
  roomCode = code; initRefs(); myRole = 'student';
  myName = await resolveUniqueName(code, desiredName);
  const existingSnap = await get(ref(db, `rooms/${roomCode}/players/${myId}`));
  if (existingSnap.exists()) await update(ref(db, `rooms/${roomCode}/players/${myId}`), { name: myName });
  else await set(ref(db, `rooms/${roomCode}/players/${myId}`), { name: myName, role: 'student', score: 0, drawCount: 0, correctCount: 0, joinedAt: Date.now() });
  localStorage.setItem('gm_session', JSON.stringify({ code: roomCode, name: myName, role: myRole, appVersion: APP_VERSION }));
  await attachPresence(myName);
  rulesShownForRoom = false;
  enterWaiting();
}

async function enterWaiting() {
  detachAllListeners();
  showScreen('screenWaiting');
  document.getElementById('waitingRoomCode').textContent = roomCode;
  document.getElementById('teacherWaitControls').classList.toggle('hidden', myRole !== 'teacher');
  addListener('waiting_players', playersRef, snap => {
    const players = snap.val() || {};
    window.__playersCache = players;
    const list = document.getElementById('playerList');
    list.innerHTML = '';
    Object.entries(players).forEach(([uid, p]) => {
      const chip = document.createElement('div');
      chip.className = 'chip' + (uid === myId ? ' me' : '');
      chip.textContent = `${p.role === 'teacher' ? '👩‍🏫' : '🧒'} ${p.name}`;
      list.appendChild(chip);
    });
    const studentCount = Object.values(players).filter(p => p.role === 'student').length;
    document.getElementById('waitingStatus').textContent = `현재 학생 ${studentCount}명 접속 중`;
    document.getElementById('startBtn').disabled = studentCount < 1;
  });
  addListener('waiting_game', gameRef, snap => {
    const g = snap.val();
    if (!g) return;
    if (g.status === 'playing') enterGame();
    if (g.status === 'result') showResult();
  });
}

async function startGame() {
  await update(roomRef, { status: 'playing' });
  const [playersSnap, settingsSnap] = await Promise.all([get(playersRef), get(settingsRef)]);
  const players = playersSnap.val() || {};
  window.__playersCache = players;
  const settings = settingsSnap.val() || {};
  const orderedWords = (settings.words && settings.words.length) ? settings.words : [];
  if (!orderedWords.length) {
    await update(roomRef, { status: 'waiting' });
    toast('제시어가 없어 게임을 시작할 수 없어.');
    return;
  }
  const drawerId = getNextDrawer(players, []);
  const keyword = orderedWords[0];
  await update(gameRef, { status: 'playing', round: 1, totalRounds: orderedWords.length, drawerId, keyword, timeLimit: settings.timeLimit, timerStart: Date.now(), answeredBy: '', usedWords: [keyword], usedDrawers: drawerId ? [drawerId] : [], roundOver: false });
  if (drawerId) await runTransaction(ref(db, `rooms/${roomCode}/players/${drawerId}/drawCount`), v => (v || 0) + 1);
  await set(canvasRef, { data: '', ts: Date.now() });
  await remove(chatRef);
  lastCelebrationKey = '';
  currentRoundSeen = 0;
}

function enterGame() {
  detachAllListeners();
  showScreen('screenGame');
  document.getElementById('gameRoomCode').textContent = roomCode;
  setupCanvas();

  addListener('game_players', playersRef, snap => {
    playersCache = snap.val() || {};
    window.__playersCache = playersCache;
    const scoreBoard = document.getElementById('scoreBoard');
    if (scoreBoard) {
      scoreBoard.innerHTML = '';
      Object.entries(playersCache).filter(([, p]) => p.role === 'student').forEach(([uid, p]) => {
        const item = document.createElement('div');
        item.className = 'score-item';
        item.textContent = `${p.name}: ${p.score || 0}점 / 정답 ${p.correctCount || 0}회 / 출제 ${p.drawCount || 0}회`;
        scoreBoard.appendChild(item);
      });
    }
  });

  addListener('game_state', gameRef, async snap => {
    const g = snap.val();
    if (!g) return;
    gameCache = g;
    if (g.status === 'result') return showResult();

    const players = playersCache || {};
    window.__playersCache = players;
    isDrawer = g.drawerId === myId;

    document.getElementById('curRound').textContent = g.round || 0;
    document.getElementById('totalRound').textContent = g.totalRounds || 0;
    document.getElementById('drawerNameDisplay').textContent = players[g.drawerId]?.name || '-';
    document.getElementById('drawerNameMini').textContent = players[g.drawerId]?.name || '-';
    document.getElementById('keywordDisplay').textContent = isDrawer ? (g.keyword || '') : '비밀';
    document.getElementById('wordBanner').classList.toggle('hidden', !isDrawer);
    document.getElementById('drawerNotice').classList.toggle('hidden', !isDrawer);
    document.getElementById('answerWrap').classList.toggle('hidden', isDrawer);
    document.getElementById('teacherGameControls').classList.toggle('hidden', myRole !== 'teacher');
    document.getElementById('teacherMonitor').classList.toggle('hidden', myRole !== 'teacher');

    if (myRole === 'teacher') {
      const mon = document.getElementById('teacherMonitorContent');
      mon.innerHTML = `<strong>현재 출제자:</strong> ${players[g.drawerId]?.name || '-'}<br><strong>현재 라운드:</strong> ${g.round || 0} / ${g.totalRounds || 0}<br><strong>상태:</strong> ${g.roundOver ? '정답 처리 중' : '진행 중'}`;
    }

    if (g.round !== currentRoundSeen) {
      currentRoundSeen = g.round || 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      undoStack = [];
    }

    const drawerTurnKey = `${g.round}-${g.drawerId || ''}`;
    if (isDrawer && drawerTurnKey && lastDrawerTurnKey !== drawerTurnKey) {
      lastDrawerTurnKey = drawerTurnKey;
      showCenterPopup('당신이 그릴 차례입니다!!', '3초 동안 준비하고 그림을 시작하세요!', 3000, 'success');
    }

    const celebrationKey = `${g.round}-${g.answeredBy || ''}`;
    if (g.roundOver && g.answeredBy && lastCelebrationKey !== celebrationKey) {
      lastCelebrationKey = celebrationKey;
      const winnerName = players[g.answeredBy]?.name || '어떤 학생';
      showCenterPopup('정답입니다!!', `${winnerName} +10점 획득!!`, 3000, 'success');
      playCorrectSound();
    }

    if (myRole === 'teacher' && g.roundOver && g.answeredBy && !nextRoundScheduled) {
      nextRoundScheduled = true;
      setTimeout(async () => {
        nextRoundScheduled = false;
        const latest = await get(gameRef), latestGame = latest.val();
        if (latestGame && latestGame.roundOver && latestGame.answeredBy) await nextRound();
      }, 5000);
    }

    if (g.round === 1 && !g.roundOver && !rulesShownForRoom) showRulesOverlay();
    startTimer(g.timerStart, g.timeLimit, g.roundOver);
  });

  addListener('game_chat', chatRef, async snap => {
    const box = document.getElementById('chatBox');
    box.innerHTML = '';
    const msgs = snap.val() || {};
    const msgList = Object.entries(msgs).map(([id, msg]) => ({ id, ...msg })).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    msgList.forEach(msg => {
      const div = document.createElement('div');
      div.className = 'msg' + (msg.system ? ' system' : '') + (msg.correct ? ' correct' : '');
      if (msg.system) div.textContent = msg.text;
      else div.innerHTML = `<span class="name">${msg.name}</span>: ${msg.text}`;
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
    if (myRole === 'teacher') await processCorrectAnswerFromChat(msgList);
  });

  addListener('game_canvas', canvasRef, snap => {
    if (isDrawer) return;
    const data = snap.val();
    if (!data?.data) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
    img.src = data.data;
  });
}

async function processCorrectAnswerFromChat(msgList) {
  const g = gameCache || {};
  if (!g || g.roundOver || !g.keyword) return;
  const candidate = msgList.find(msg =>
    !msg.system &&
    (msg.round === g.round) &&
    (msg.isCorrectGuess === true || String(msg.text || '').toLowerCase() === String(g.keyword || '').toLowerCase())
  );
  if (!candidate) return;
  const answerRef = ref(db, `rooms/${roomCode}/game/answeredBy`);
  let won = false;
  await runTransaction(answerRef, current => { if (!current) { won = true; return candidate.uid || ''; } return current; });
  if (!won) return;
  await Promise.all([
    runTransaction(ref(db, `rooms/${roomCode}/players/${candidate.uid}/score`), v => (v || 0) + 10),
    runTransaction(ref(db, `rooms/${roomCode}/players/${candidate.uid}/correctCount`), v => (v || 0) + 1),
    runTransaction(ref(db, `rooms/${roomCode}/players/${g.drawerId}/score`), v => (v || 0) + 5),
    update(gameRef, { roundOver: true }),
    update(ref(db, `rooms/${roomCode}/chat/${candidate.id}`), { correct: true }),
    addSystemChat(`정답입니다! ${candidate.name} +10점 / 출제자 +5점`)
  ]);
}

function startTimer(startTs, limit, roundOver) {
  if (timerInterval) clearInterval(timerInterval);
  const display = document.getElementById('timerDisplay');
  if (roundOver) { display.textContent = '정답! 🎉'; return; }
  timerInterval = setInterval(async () => {
    const remain = Math.max(0, limit - Math.floor((Date.now() - startTs) / 1000));
    const m = Math.floor(remain / 60).toString().padStart(2, '0'),
      s = (remain % 60).toString().padStart(2, '0');
    display.textContent = `${m}:${s}`;
    if (remain === 0) {
      clearInterval(timerInterval);
      if (myRole === 'teacher') {
        const g = gameCache || {};
        if (g && !g.roundOver) {
          showCenterPopup('아쉽게 실패!', `정답은 "${g.keyword}" · 다음 라운드로 이동`, 3000, 'fail');
          playFailSound();
          await addSystemChat(`⏰ 시간 종료! 정답은 "${g.keyword}"`);
          setTimeout(async () => { await nextRound(); }, 3000);
        }
      }
    }
  }, 500);
}

async function addSystemChat(text) {
  await push(chatRef, { system: true, text, ts: Date.now() });
}

async function submitAnswer() {
  const input = document.getElementById('answerInput'), raw = input.value, answer = sanitizeAnswer(raw);
  input.value = '';
  if (!answer || isDrawer) return;
  if (containsBannedWord(answer)) return toast('이 표현은 입력할 수 없어.');
  const gameSnap = await get(gameRef), g = gameSnap.val();
  if (!g || g.roundOver) return;
  const isCorrect = answer.toLowerCase() == String(g.keyword || '').toLowerCase();
  await push(chatRef, { uid: myId, name: myName, text: answer, ts: Date.now(), round: g.round, isCorrectGuess: isCorrect });
  if (!isCorrect) {
    const wrongKey = `${g.round}-${myId}-${answer}`;
    if (lastWrongPopupKey !== wrongKey) {
      lastWrongPopupKey = wrongKey;
      showCenterPopup('오답입니다!!', '다시 도전하세요!!', 1800, 'fail');
      playFailSound();
    }
  }
}

async function nextRound() {
  const [gameSnap, settingsSnap, playersSnap] = await Promise.all([get(gameRef), get(settingsRef), get(playersRef)]);
  const g = gameSnap.val(), settings = settingsSnap.val() || {}, players = playersSnap.val() || {};
  window.__playersCache = players;
  if (!g) return;
  const orderedWords = (settings.words && settings.words.length) ? settings.words : [];
  if (!orderedWords.length || g.round >= orderedWords.length) {
    await update(gameRef, { status: 'result' });
    await update(roomRef, { status: 'closed' });
    return;
  }
  const nextWord = orderedWords[g.round];
  const usedWords = orderedWords.slice(0, g.round + 1);
  const students = Object.entries(players).filter(([, p]) => p.role === 'student').map(([uid]) => uid);
  let usedDrawers = g.usedDrawers || [];
  const everyoneDone = students.length > 0 && students.every(uid => usedDrawers.includes(uid));
  if (everyoneDone) { usedDrawers = []; }
  const nextDrawer = getNextDrawer(players, usedDrawers);
  const nextUsedDrawers = nextDrawer ? [...usedDrawers, nextDrawer] : usedDrawers;
  await update(gameRef, { round: g.round + 1, drawerId: nextDrawer || '', keyword: nextWord, timerStart: Date.now(), answeredBy: '', roundOver: false, usedWords, usedDrawers: nextUsedDrawers });
  if (nextDrawer) await runTransaction(ref(db, `rooms/${roomCode}/players/${nextDrawer}/drawCount`), v => (v || 0) + 1);
  await set(canvasRef, { data: '', ts: Date.now() });
  await remove(chatRef);
  lastCelebrationKey = '';
}

function renderPalette() {
  const palette = document.getElementById('colorPalette');
  palette.innerHTML = '';
  COLORS.forEach(color => {
    const dot = document.createElement('div');
    dot.className = 'color-dot' + (color === brushColor ? ' active' : '');
    dot.style.background = color;
    dot.onclick = () => { brushColor = color; erasing = false; renderPalette(); };
    palette.appendChild(dot);
  });
}

function setupCanvas() {
  if (canvasEventsBound) return;
  canvasEventsBound = true;
  renderPalette();
  let lastX = 0, lastY = 0, canvasDirty = false, lastCanvasSyncAt = 0;
  const pos = e => {
    const rect = canvas.getBoundingClientRect(),
      scaleX = canvas.width / rect.width,
      scaleY = canvas.height / rect.height,
      src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
  };
  const syncCanvas = () => {
    if (!canvasRef || !canvasDirty) return;
    canvasDirty = false;
    lastCanvasSyncAt = Date.now();
    set(canvasRef, { data: canvas.toDataURL('image/jpeg', 0.45), ts: lastCanvasSyncAt });
  };
  const start = e => {
    if (!isDrawer) return;
    e.preventDefault();
    saveUndoState();
    drawing = true;
    const p = pos(e);
    lastX = p.x; lastY = p.y;
  };
  const move = e => {
    if (!drawing || !isDrawer) return;
    e.preventDefault();
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = erasing ? '#2d5a27' : brushColor;
    ctx.lineWidth = erasing ? brushSize * 3 : brushSize;
    ctx.lineCap = 'round';
    ctx.stroke();
    lastX = p.x; lastY = p.y;
    canvasDirty = true;
    if (!window.__canvasThrottle) {
      window.__canvasThrottle = setTimeout(() => { syncCanvas(); window.__canvasThrottle = null; }, 800);
    }
  };
  const end = () => {
    if (drawing && isDrawer && canvasDirty && (Date.now() - lastCanvasSyncAt > 250)) syncCanvas();
    drawing = false;
  };
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseup', end);
  canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
}

function saveUndoState() {
  try {
    undoStack.push(canvas.toDataURL());
    if (undoStack.length > 20) undoStack.shift();
  } catch (e) { console.error(e); }
}

function undoCanvas() {
  if (!isDrawer || !undoStack.length) return;
  const prev = undoStack.pop(), img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    if (canvasRef) set(canvasRef, { data: canvas.toDataURL('image/jpeg', 0.45), ts: Date.now() });
  };
  img.src = prev;
}

function clearCanvas() {
  if (isDrawer) saveUndoState();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (canvasRef) set(canvasRef, { data: '', ts: Date.now() });
}

function toggleEraser() {
  erasing = !erasing;
  document.getElementById('eraserBtn').textContent = erasing ? '🧹 지우개 ON' : '🧹 지우개';
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('soundBtn');
  if (btn) btn.textContent = soundEnabled ? '🔔 효과음 ON' : '🔕 효과음 OFF';
}

async function showResult() {
  if (timerInterval) clearInterval(timerInterval);
  detachAllListeners();
  showScreen('screenResult');
  const playersSnap = await get(playersRef), players = playersSnap.val() || {},
    students = Object.values(players).filter(p => p.role === 'student'),
    medals = ['🥇', '🥈', '🥉'];
  const list = document.getElementById('resultList');
  list.innerHTML = '<h3>🏅 개인 TOP 3</h3>';
  const ranked = [...students].sort((a, b) => (b.score || 0) - (a.score || 0));
  ranked.slice(0, 3).forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.innerHTML = `<div>${medals[idx] || `${idx + 1}위`} ${p.name}</div><div>${p.score || 0}점</div>`;
    list.appendChild(div);
  });
  const awardTitle = document.createElement('h3');
  awardTitle.style.marginTop = '20px';
  awardTitle.textContent = '🌟 칭찬 타이틀';
  list.appendChild(awardTitle);
  const byCorrect = [...students].sort((a, b) => (b.correctCount || 0) - (a.correctCount || 0)),
    byDraw = [...students].sort((a, b) => (b.drawCount || 0) - (a.drawCount || 0));
  const badgeLine = document.createElement('div');
  badgeLine.className = 'badge-line';
  [
    { title: '🎯 정답왕', name: byCorrect[0]?.name || '-', value: `${byCorrect[0]?.correctCount || 0}회 정답` },
    { title: '🎨 그림왕', name: byDraw[0]?.name || '-', value: `${byDraw[0]?.drawCount || 0}회 출제` },
    { title: '👑 종합 1위', name: ranked[0]?.name || '-', value: `${ranked[0]?.score || 0}점` }
  ].forEach(a => {
    const card = document.createElement('div');
    card.className = 'badge-card';
    card.innerHTML = `<strong>${a.title}</strong><br>${a.name}<br><span class="small">${a.value}</span>`;
    badgeLine.appendChild(card);
  });
  list.appendChild(badgeLine);
}

async function backToLobby() {
  detachAllListeners();
  if (timerInterval) clearInterval(timerInterval);
  rulesShownForRoom = false;
  const overlay = document.getElementById('rulesOverlay');
  if (overlay) overlay.classList.add('hidden');
  if (roomCode && myRole === 'teacher') {
    try { await update(roomRef, { status: 'closed' }); } catch (e) { console.error(e); }
  }
  localStorage.removeItem('gm_session');
  showScreen('screenLobby');
}

async function restoreSession() {
  const saved = JSON.parse(localStorage.getItem('gm_session') || 'null');
  if (!saved) return;
  if (saved.appVersion && saved.appVersion !== APP_VERSION) {
    localStorage.removeItem('gm_session');
    return;
  }
  const roomSnap = await get(ref(db, `rooms/${saved.code}`));
  if (!roomSnap.exists()) { localStorage.removeItem('gm_session'); return; }
  const roomMeta = roomSnap.val() || {};
  if (roomMeta.appVersion !== APP_VERSION || roomMeta.status === 'closed') {
    localStorage.removeItem('gm_session');
    return;
  }
  roomCode = saved.code;
  initRefs();
  const settingsSnap = await get(settingsRef);
  const settings = settingsSnap.val() || {};
  if (settings.appVersion && settings.appVersion !== APP_VERSION) {
    localStorage.removeItem('gm_session');
    return;
  }
  const playerSnap = await get(ref(db, `rooms/${roomCode}/players/${myId}`));
  if (!playerSnap.exists()) { localStorage.removeItem('gm_session'); return; }
  myName = playerSnap.val().name;
  myRole = playerSnap.val().role;
  await attachPresence(myName);
  const gameSnap = await get(gameRef), game = gameSnap.val();
  playersCache = {};
  gameCache = {};
  if (game?.status === 'playing') enterGame();
  else if (game?.status === 'result') showResult();
  else enterWaiting();
}

(async function boot() {
  await ensureAnonymousAuth();
  await restoreSession();
})();
