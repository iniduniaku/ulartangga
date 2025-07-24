const socket = io();

// Game state
let currentScreen = 'menu';
let gameState = {
    players: [],
    currentPlayer: null,
    roomId: null,
    myPlayerId: null
};

// Chat state
let chatState = {
    isOpen: false,
    unreadCount: 0,
    messages: []
};

// Board configuration
const SNAKES = {
    16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78
};

const LADDERS = {
    1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100
};

// Initialize game
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupSocketEvents();
    createGameBoard();
});

function setupEventListeners() {
    // Menu screen
    document.getElementById('joinGameBtn').addEventListener('click', () => {
        const name = document.getElementById('playerName').value.trim();
        if (name) {
            gameState.myPlayerId = socket.id;
            socket.emit('joinGame', { name: name });
        }
    });
    
    // Game controls
    document.getElementById('rollDiceBtn').addEventListener('click', () => {
        socket.emit('rollDice');
        document.getElementById('rollDiceBtn').disabled = true;
    });
    
    // Play again
    document.getElementById('playAgainBtn').addEventListener('click', () => {
        showScreen('menu');
        resetGameState();
    });
    
    // Enter key support
    document.getElementById('playerName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('joinGameBtn').click();
        }
    });
    
    // Chat event listeners
    document.getElementById('chatToggle').addEventListener('click', toggleChat);
    document.getElementById('closeChatBtn').addEventListener('click', closeChat);
    document.getElementById('sendChatBtn').addEventListener('click', sendMessage);
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    // Emoji buttons
    document.querySelectorAll('.emoji-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const emoji = e.target.dataset.emoji;
            const input = document.getElementById('chatInput');
            input.value += emoji;
            input.focus();
        });
    });
}

function setupSocketEvents() {
    socket.on('waitingForPlayers', (data) => {
        gameState.players = data.players;
        gameState.roomId = data.roomId;
        updatePlayersList();
        showScreen('waiting');
    });
    
    socket.on('playerJoined', (data) => {
        gameState.players = data.players;
        updatePlayersList();
        showMessage(`${data.players[data.players.length - 1].name} bergabung!`);
    });
    
    socket.on('gameStart', (data) => {
        gameState.players = data.players;
        gameState.currentPlayer = data.currentPlayer;
        showScreen('game');
        updateGameDisplay();
        showMessage('Game dimulai! 🎮');
    });
    
    socket.on('diceRolled', (data) => {
        animateDice(data.diceValue);
        showMessage(`${data.playerName} melempar dadu: ${data.diceValue}`);
    });
    
    socket.on('playerMoved', (data) => {
        // Update player positions
        const player = gameState.players.find(p => p.id === data.playerId);
        if (player) {
            player.position = data.newPosition;
        }
        gameState.players = data.players;
        
        updateGameBoard();
        
        if (data.specialMove) {
            if (data.specialMove.type === 'snake') {
                showMessage(`🐍 Ular! ${player.name} turun dari ${data.specialMove.from} ke ${data.specialMove.to}`);
            } else if (data.specialMove.type === 'ladder') {
                showMessage(`🪜 Tangga! ${player.name} naik dari ${data.specialMove.from} ke ${data.specialMove.to}`);
            }
        }
    });
    
    socket.on('turnChanged', (data) => {
        gameState.currentPlayer = data.currentPlayer;
        gameState.players = data.players;
        updateGameDisplay();
        
        if (data.message) {
            showMessage(data.message);
        }
        
        // Enable dice button if it's my turn
        const isMyTurn = gameState.currentPlayer && gameState.currentPlayer.id === socket.id;
        document.getElementById('rollDiceBtn').disabled = !isMyTurn;
    });
    
    socket.on('gameWon', (data) => {
        showWinScreen(data.winner);
    });
    
    socket.on('playerLeft', (data) => {
        gameState.players = data.players;
        updateGameDisplay();
        updatePlayersList();
        showMessage('Seorang pemain keluar dari game');
    });
    
    // Chat socket events
    socket.on('newMessage', (messageData) => {
        addChatMessage(messageData);
        
        // Show notification if chat is closed and message is not from current user
        if (!chatState.isOpen && messageData.playerId !== socket.id) {
            chatState.unreadCount++;
            updateChatNotification();
        }
    });
    
    socket.on('connect', () => {
        console.log('Connected to server');
    });
    
    socket.on('disconnect', () => {
        showMessage('Koneksi terputus');
    });
}

function createGameBoard() {
    const board = document.getElementById('gameBoard');
    board.innerHTML = '';
    
    // Create cells 1-100 (reversed for snake and ladder style)
    for (let row = 9; row >= 0; row--) {
        for (let col = 0; col < 10; col++) {
            let cellNumber;
            if (row % 2 === 1) {
                // Odd rows go right to left
                cellNumber = row * 10 + (10 - col);
            } else {
                // Even rows go left to right
                cellNumber = row * 10 + (col + 1);
            }
            
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.id = `cell-${cellNumber}`;
            
            // Add special styling for snakes and ladders
            if (SNAKES[cellNumber]) {
                cell.classList.add('snake');
                cell.title = `Ular! Turun ke ${SNAKES[cellNumber]}`;
            } else if (LADDERS[cellNumber]) {
                cell.classList.add('ladder');
                cell.title = `Tangga! Naik ke ${LADDERS[cellNumber]}`;
            }
            
            cell.innerHTML = `
                <div class="cell-number">${cellNumber}</div>
                <div class="cell-players" id="players-${cellNumber}"></div>
            `;
            
            board.appendChild(cell);
        }
    }
}

function updateGameBoard() {
    // Clear all player pieces
    document.querySelectorAll('.cell-players').forEach(el => {
        el.innerHTML = '';
    });
    
    // Place players on board
    gameState.players.forEach(player => {
        if (player.position > 0) {
            const playersContainer = document.getElementById(`players-${player.position}`);
            if (playersContainer) {
                const piece = document.createElement('div');
                piece.className = 'player-piece';
                piece.style.backgroundColor = player.color;
                piece.title = `${player.name} (${player.position})`;
                playersContainer.appendChild(piece);
            }
        }
    });
}

function updatePlayersList() {
    const container = document.getElementById('playersList');
    container.innerHTML = '';
    
    gameState.players.forEach((player, index) => {
        const playerEl = document.createElement('div');
        playerEl.className = 'player-item';
        playerEl.style.backgroundColor = player.color;
        playerEl.style.color = 'white';
        playerEl.textContent = `${index + 1}. ${player.name}`;
        container.appendChild(playerEl);
    });
}

function updateGameDisplay() {
    // Update current turn display
    const currentTurnEl = document.getElementById('currentPlayerName');
    if (gameState.currentPlayer) {
        currentTurnEl.textContent = gameState.currentPlayer.name;
        currentTurnEl.style.color = gameState.currentPlayer.color;
    }
    
    // Update players info
    const playersInfoEl = document.getElementById('playersInfo');
    playersInfoEl.innerHTML = '';
    
    gameState.players.forEach(player => {
        const playerStatusEl = document.createElement('div');
        playerStatusEl.className = `player-status ${player.isActive ? 'active' : ''}`;
        
        playerStatusEl.innerHTML = `
            <div class="player-color" style="background-color: ${player.color}"></div>
            <span>${player.name}</span>
            <small>(${player.position})</small>
        `;
        
        playersInfoEl.appendChild(playerStatusEl);
    });
    
    // Enable/disable dice button
    const isMyTurn = gameState.currentPlayer && gameState.currentPlayer.id === socket.id;
    document.getElementById('rollDiceBtn').disabled = !isMyTurn;
    
    updateGameBoard();
}

function animateDice(value) {
    const diceEl = document.getElementById('diceDisplay');
    
    // Animate rolling
    let rollCount = 0;
    const rollInterval = setInterval(() => {
        diceEl.textContent = Math.floor(Math.random() * 6) + 1;
        diceEl.classList.add('dice-rolling');
        rollCount++;
        
        if (rollCount >= 10) {
            clearInterval(rollInterval);
            diceEl.textContent = value;
            diceEl.classList.remove('dice-rolling');
        }
    }, 100);
}

function showMessage(message) {
    const messageEl = document.getElementById('gameMessage');
    messageEl.textContent = message;
    
    // Auto clear message after 3 seconds
    setTimeout(() => {
        if (messageEl.textContent === message) {
            messageEl.textContent = '';
        }
    }, 3000);
}

function showWinScreen(winner) {
    document.getElementById('winnerName').textContent = winner.name;
    document.getElementById('winnerName').style.color = winner.color;
    showScreen('winScreen');
}

function showScreen(screenName) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.add('hidden');
    });
    document.getElementById(screenName).classList.remove('hidden');
    currentScreen = screenName;
    
    // Initialize chat when entering game screen
    if (screenName === 'game') {
        initializeChat();
        // Send welcome message
        setTimeout(() => {
            sendLocalSystemMessage('Selamat datang di chat game! Gunakan chat untuk berbicara dengan pemain lain. 💬');
        }, 1000);
    }
    
    // Close chat when leaving game screen
    if (screenName !== 'game') {
        closeChat();
    }
}

function resetGameState() {
    gameState = {
        players: [],
        currentPlayer: null,
        roomId: null,
        myPlayerId: socket.id
    };
    
    document.getElementById('diceDisplay').textContent = '?';
    document.getElementById('gameMessage').textContent = '';
    document.getElementById('playerName').value = '';
}

// Chat functions
function toggleChat() {
    chatState.isOpen = !chatState.isOpen;
    const chatBox = document.getElementById('chatBox');
    
    if (chatState.isOpen) {
        chatBox.classList.remove('hidden');
        document.getElementById('chatInput').focus();
        
        // Clear notifications
        chatState.unreadCount = 0;
        updateChatNotification();
        
        // Scroll to bottom
        setTimeout(() => {
            scrollChatToBottom();
        }, 100);
    } else {
        chatBox.classList.add('hidden');
    }
}

function closeChat() {
    chatState.isOpen = false;
    document.getElementById('chatBox').classList.add('hidden');
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (message && gameState.roomId) {
        // Check for commands first
        if (processChatCommand(message)) {
            input.value = '';
            return;
        }
        
        socket.emit('sendMessage', { message: message });
        input.value = '';
    }
}

function addChatMessage(messageData) {
    chatState.messages.push(messageData);
    const messagesContainer = document.getElementById('chatMessages');
    
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${messageData.playerId === socket.id ? 'own' : ''} ${messageData.type}`;
    
    let messageContent = '';
    
    if (messageData.type === 'system' || messageData.type === 'special' || messageData.type === 'win') {
        messageContent = `
            <div class="message-bubble">
                ${messageData.message}
                <div class="message-time">${messageData.timestamp}</div>
            </div>
        `;
    } else {
        messageContent = `
            <div class="message-header" style="color: ${messageData.playerColor}">
                ${messageData.playerName}
            </div>
            <div class="message-bubble" style="background-color: ${messageData.playerId === socket.id ? '#0984e3' : messageData.playerColor + '20'}; ${messageData.playerId !== socket.id ? 'color: ' + messageData.playerColor : ''}">
                ${escapeHtml(messageData.message)}
                <div class="message-time">${messageData.timestamp}</div>
            </div>
        `;
    }
    
    messageEl.innerHTML = messageContent;
    messagesContainer.appendChild(messageEl);
    
    // Remove old messages if too many (keep last 50)
    while (messagesContainer.children.length > 50) {
        messagesContainer.removeChild(messagesContainer.firstChild);
    }
    
    scrollChatToBottom();
}

function scrollChatToBottom() {
    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateChatNotification() {
    const notification = document.getElementById('chatNotification');
    
    if (chatState.unreadCount > 0) {
        notification.textContent = chatState.unreadCount > 9 ? '9+' : chatState.unreadCount;
        notification.classList.remove('hidden');
    } else {
        notification.classList.add('hidden');
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Auto-send system messages for game events
function sendLocalSystemMessage(message, type = 'system') {
    const systemMessage = {
        id: Date.now(),
        playerId: 'local-system',
        playerName: 'Info',
        playerColor: '#6c757d',
        message: message,
        timestamp: new Date().toLocaleTimeString('id-ID', { 
            hour: '2-digit', 
            minute: '2-digit' 
        }),
        type: type
    };
    
    addChatMessage(systemMessage);
}

// Initialize chat when game starts
function initializeChat() {
    chatState = {
        isOpen: false,
        unreadCount: 0,
        messages: []
    };
    
    document.getElementById('chatMessages').innerHTML = '';
    updateChatNotification();
}

// Add chat commands (optional feature)
function processChatCommand(message) {
    if (message.startsWith('/')) {
        const command = message.toLowerCase();
        
        switch (command) {
            case '/help':
                sendLocalSystemMessage('Perintah chat: /help - bantuan, /clear - bersihkan chat');
                return true;
            case '/clear':
                document.getElementById('chatMessages').innerHTML = '';
                chatState.messages = [];
                return true;
            default:
                sendLocalSystemMessage('Perintah tidak dikenal. Ketik /help untuk bantuan.');
                return true;
        }
    }
    return false;
}
