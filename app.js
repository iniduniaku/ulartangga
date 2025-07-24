const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game configuration
const SNAKES = {
    16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78
};

const LADDERS = {
    1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100
};

// Game state
let gameRooms = {};
let waitingPlayers = [];

class GameRoom {
    constructor(roomId, players) {
        this.roomId = roomId;
        this.players = players.map((player, index) => ({
            id: player.id,
            name: player.name,
            position: 0,
            color: this.getPlayerColor(index),
            isActive: false
        }));
        this.currentPlayerIndex = 0;
        this.gameState = 'waiting';
        this.diceValue = 0;
        this.winner = null;
        
        // Set first player as active
        if (this.players.length > 0) {
            this.players[0].isActive = true;
        }
    }
    
    getPlayerColor(index) {
        const colors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12'];
        return colors[index % colors.length];
    }
    
    rollDice() {
        return Math.floor(Math.random() * 6) + 1;
    }
    
    movePlayer(playerId, steps) {
        const player = this.players.find(p => p.id === playerId);
        if (!player || !player.isActive) return false;
        
        let newPosition = player.position + steps;
        
        // Check if player goes beyond 100
        if (newPosition > 100) {
            return { moved: false, reason: 'beyond_100' };
        }
        
        player.position = newPosition;
        
        // Check for snakes and ladders
        let specialMove = null;
        if (SNAKES[newPosition]) {
            player.position = SNAKES[newPosition];
            specialMove = { type: 'snake', from: newPosition, to: SNAKES[newPosition] };
        } else if (LADDERS[newPosition]) {
            player.position = LADDERS[newPosition];
            specialMove = { type: 'ladder', from: newPosition, to: LADDERS[newPosition] };
        }
        
        // Check win condition
        if (player.position === 100) {
            this.winner = player;
            this.gameState = 'finished';
            return { moved: true, won: true, specialMove };
        }
        
        return { moved: true, won: false, specialMove };
    }
    
    nextTurn() {
        // Deactivate current player
        this.players[this.currentPlayerIndex].isActive = false;
        
        // Move to next player
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
        this.players[this.currentPlayerIndex].isActive = true;
    }
    
    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }
}

// System messages for game events
function sendSystemMessage(roomId, message, type = 'system') {
    const systemMessage = {
        id: Date.now(),
        playerId: 'system',
        playerName: 'System',
        playerColor: '#6c757d',
        message: message,
        timestamp: new Date().toLocaleTimeString('id-ID', { 
            hour: '2-digit', 
            minute: '2-digit' 
        }),
        type: type
    };
    
    io.to(roomId).emit('newMessage', systemMessage);
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    socket.on('joinGame', (playerData) => {
        socket.playerData = playerData;
        
        // Find existing room with space or create new one
        let room = Object.values(gameRooms).find(r => 
            r.gameState === 'waiting' && r.players.length < 4
        );
        
        if (room) {
            // Join existing room
            room.players.push({
                id: socket.id,
                name: playerData.name,
                position: 0,
                color: room.getPlayerColor(room.players.length),
                isActive: false
            });
            
            socket.join(room.roomId);
            socket.roomId = room.roomId;
            
            // Send system message when player joins
            if (room.players.length > 1) {
                sendSystemMessage(room.roomId, `${playerData.name} bergabung ke game!`);
            }
            
            // Update all players in room
            io.to(room.roomId).emit('playerJoined', {
                players: room.players,
                roomId: room.roomId
            });
            
            // Start game if we have enough players
            if (room.players.length >= 2) {
                setTimeout(() => {
                    room.gameState = 'playing';
                    room.players[0].isActive = true;
                    sendSystemMessage(room.roomId, 'Game dimulai! Semoga beruntung! 🎮');
                    io.to(room.roomId).emit('gameStart', {
                        players: room.players,
                        currentPlayer: room.getCurrentPlayer()
                    });
                }, 2000);
            }
            
        } else {
            // Create new room
            const roomId = `room_${Date.now()}_${socket.id}`;
            room = new GameRoom(roomId, [{ id: socket.id, name: playerData.name }]);
            gameRooms[roomId] = room;
            
            socket.join(roomId);
            socket.roomId = roomId;
            
            socket.emit('waitingForPlayers', {
                players: room.players,
                roomId: roomId
            });
        }
    });
    
    socket.on('rollDice', () => {
        const room = gameRooms[socket.roomId];
        if (!room || room.gameState !== 'playing') return;
        
        const currentPlayer = room.getCurrentPlayer();
        if (currentPlayer.id !== socket.id) return;
        
        const diceValue = room.rollDice();
        room.diceValue = diceValue;
        
        io.to(room.roomId).emit('diceRolled', {
            playerId: socket.id,
            diceValue: diceValue,
            playerName: currentPlayer.name
        });
        
        // Auto move after dice roll
        setTimeout(() => {
            const moveResult = room.movePlayer(socket.id, diceValue);
            
            if (moveResult.moved) {
                io.to(room.roomId).emit('playerMoved', {
                    playerId: socket.id,
                    newPosition: currentPlayer.position,
                    specialMove: moveResult.specialMove,
                    players: room.players
                });
                
                // Send system message for special moves
                if (moveResult.specialMove) {
                    if (moveResult.specialMove.type === 'snake') {
                        sendSystemMessage(room.roomId, 
                            `🐍 ${currentPlayer.name} terkena ular! Turun dari ${moveResult.specialMove.from} ke ${moveResult.specialMove.to}`, 
                            'special'
                        );
                    } else if (moveResult.specialMove.type === 'ladder') {
                        sendSystemMessage(room.roomId, 
                            `🪜 ${currentPlayer.name} naik tangga! Dari ${moveResult.specialMove.from} ke ${moveResult.specialMove.to}`, 
                            'special'
                        );
                    }
                }
                
                if (moveResult.won) {
                    sendSystemMessage(room.roomId, 
                        `🎉 ${room.winner.name} memenangkan permainan!`, 
                        'win'
                    );
                    io.to(room.roomId).emit('gameWon', {
                        winner: room.winner
                    });
                } else {
                    // Next turn if didn't get 6
                    if (diceValue !== 6) {
                        room.nextTurn();
                    }
                    
                    io.to(room.roomId).emit('turnChanged', {
                        currentPlayer: room.getCurrentPlayer(),
                        players: room.players
                    });
                }
            } else {
                // Move not allowed, next turn
                room.nextTurn();
                io.to(room.roomId).emit('turnChanged', {
                    currentPlayer: room.getCurrentPlayer(),
                    players: room.players,
                    message: 'Tidak bisa bergerak melewati kotak 100!'
                });
            }
        }, 2000);
    });
    
    // Chat functionality
    socket.on('sendMessage', (data) => {
        const room = gameRooms[socket.roomId];
        if (!room) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        
        const chatMessage = {
            id: Date.now(),
            playerId: socket.id,
            playerName: player.name,
            playerColor: player.color,
            message: data.message.trim(),
            timestamp: new Date().toLocaleTimeString('id-ID', { 
                hour: '2-digit', 
                minute: '2-digit' 
            }),
            type: 'player'
        };
        
        // Broadcast to all players in room
        io.to(room.roomId).emit('newMessage', chatMessage);
    });
    
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        
        if (socket.roomId && gameRooms[socket.roomId]) {
            const room = gameRooms[socket.roomId];
            const disconnectedPlayer = room.players.find(p => p.id === socket.id);
            
            // Send system message about player leaving
            if (disconnectedPlayer) {
                sendSystemMessage(socket.roomId, `${disconnectedPlayer.name} keluar dari game`);
            }
            
            // Remove player from room
            room.players = room.players.filter(p => p.id !== socket.id);
            
            if (room.players.length === 0) {
                // Delete empty room
                delete gameRooms[socket.roomId];
            } else {
                // Notify remaining players
                io.to(socket.roomId).emit('playerLeft', {
                    players: room.players,
                    disconnectedId: socket.id
                });
                
                // Adjust current player index if needed
                if (room.currentPlayerIndex >= room.players.length) {
                    room.currentPlayerIndex = 0;
                }
                
                if (room.players.length > 0) {
                    room.players.forEach(p => p.isActive = false);
                    room.players[room.currentPlayerIndex].isActive = true;
                    
                    io.to(socket.roomId).emit('turnChanged', {
                        currentPlayer: room.getCurrentPlayer(),
                        players: room.players
                    });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 80;
server.listen(PORT, () => {
    console.log(`Snakes and Ladders server running on port ${PORT}`);
});
