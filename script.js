// --- Game State and Board Setup ---
let game = new Chess();
let board = null;
let gameStarted = false;
let isAITurn = false; // Flag to prevent multiple AI calls

// DOM Elements
const ai1ModelSelect = document.getElementById('ai1-model');
const ai2ModelSelect = document.getElementById('ai2-model');
const apiKeyInput = document.getElementById('api-key');
const testKeyButton = document.getElementById('test-key');
const keyStatusSpan = document.getElementById('key-status');
const playNowButton = document.getElementById('play-now');
const logContentDiv = document.getElementById('log-content');
const controlsDiv = document.querySelector('.controls'); // Get controls div to disable

// API Configuration (Add your API endpoint and potential model mappings)
const API_ENDPOINTS = {
    'gemini-pro': 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', // Replace with actual endpoint
    'gpt-4': 'YOUR_OPENAI_API_ENDPOINT/v1/chat/completions', // Replace with actual endpoint
    // Add more endpoints here
};

const API_HEADERS = {
    'gemini-pro': (apiKey) => ({
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey // Gemini typically uses this header or query param
    }),
     'gpt-4': (apiKey) => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}` // OpenAI uses Bearer token
    }),
     // Add headers for other models
};

// --- Helper Functions ---

function appendToLog(message, isReason = false) {
    const p = document.createElement('p');
    p.textContent = message;
    if (isReason) {
        p.classList.add('reason'); // Optional: add a class for styling reasons
    }
    logContentDiv.appendChild(p);
    // Auto-scroll to the bottom
    logContentDiv.scrollTop = logContentDiv.scrollHeight;
}

function updateStatus(element, message, type) {
    element.textContent = message;
    element.className = 'status ' + type; // success or error
}

function disableControls() {
    controlsDiv.querySelectorAll('select, input, button').forEach(el => {
        if (el.id !== 'log-content') el.disabled = true;
    });
     // Re-enable test key button if needed later, but for now, disable all after play starts
}

function enableControls() {
     controlsDiv.querySelectorAll('select, input, button').forEach(el => {
         if (el.id !== 'log-content' && el.id !== 'play-now') el.disabled = false; // Keep play now disabled until key is tested again
     });
}

// --- API Interaction ---

async function testApiKey(apiKey) {
    const selectedModel = ai1ModelSelect.value; // Use AI1 model for testing
    const apiEndpoint = API_ENDPOINTS[selectedModel];

    if (selectedModel === 'random') {
         updateStatus(keyStatusSpan, 'No API key needed for Random AI.', 'success');
         playNowButton.disabled = false;
         return true;
    }


    if (!apiKey || !apiEndpoint) {
        updateStatus(keyStatusSpan, 'Select an AI model and enter API key.', 'error');
        playNowButton.disabled = true;
        return false;
    }

    updateStatus(keyStatusSpan, 'Testing...', '');
    testKeyButton.disabled = true;

    // Create a minimal test prompt for the selected model
    let testPrompt;
    let requestBody;

    if (selectedModel === 'gemini-pro') {
        testPrompt = "Respond with 'OK' if you are working.";
        requestBody = {
            contents: [{ parts: [{ text: testPrompt }] }]
        };
    } else if (selectedModel === 'gpt-4') {
         testPrompt = "Respond with 'OK' if you are working.";
         requestBody = {
             model: 'gpt-4', // Use the correct model name
             messages: [{ role: "user", content: testPrompt }],
             max_tokens: 10, // Keep response small
             temperature: 0 // Make response predictable
         };
    } else {
        updateStatus(keyStatusSpan, `Test not implemented for model: ${selectedModel}`, 'error');
        testKeyButton.disabled = false;
        playNowButton.disabled = true;
        return false;
    }

    try {
        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: API_HEADERS[selectedModel](apiKey),
            body: JSON.stringify(requestBody)
        });

        if (response.ok) {
            const data = await response.json();
             // Check response content based on model
             let responseText = '';
             if (selectedModel === 'gemini-pro' && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
                 responseText = data.candidates[0].content.parts[0].text;
             } else if (selectedModel === 'gpt-4' && data.choices && data.choices[0] && data.choices[0].message) {
                 responseText = data.choices[0].message.content;
             }

            // Basic check if the response contains something or specific text
            if (responseText && responseText.toUpperCase().includes('OK')) {
                 updateStatus(keyStatusSpan, 'Key is valid!', 'success');
                 playNowButton.disabled = false; // Enable play button
                 return true;
            } else {
                 updateStatus(keyStatusSpan, 'Key might be valid, but test failed. Check console.', 'error');
                 console.error('API test unexpected response:', data);
                 playNowButton.disabled = true;
                 return false;
            }

        } else {
            const errorData = await response.json();
            updateStatus(keyStatusSpan, `API Error: ${response.status} ${response.statusText}`, 'error');
            console.error('API test failed:', errorData);
            playNowButton.disabled = true;
            return false;
        }
    } catch (error) {
        updateStatus(keyStatusSpan, `Network Error: ${error.message}`, 'error');
        console.error('API test network error:', error);
        playNowButton.disabled = true;
        return false;
    } finally {
        testKeyButton.disabled = false;
    }
}

async function getAIMove(fen, modelName, apiKey) {
    const apiEndpoint = API_ENDPOINTS[modelName];
     const headers = API_HEADERS[modelName](apiKey);

    if (!apiEndpoint) {
        return { move: null, reason: `API endpoint not configured for ${modelName}` };
    }

    // --- Prompt Engineering ---
    // This is CRITICAL and will likely need significant tweaking for different LLMs.
    // The goal is to get the AI to output the move and reason in a PARSABLE format.
    const turn = game.turn() === 'w' ? 'White' : 'Black';
    const prompt = `You are a chess AI. Given the current chess position in FEN format: ${fen}. It is ${turn}'s turn. Please provide only your best move in UCI format (e.g., 'e2e4', 'a7a8q' for promotion) and a brief explanation for the move. Format your response strictly as:\nMOVE: [your UCI move]\nREASON: [your brief explanation]\n`;

    let requestBody;
     if (modelName.startsWith('gemini')) { // Covers gemini-pro etc.
         requestBody = {
             contents: [{ parts: [{ text: prompt }] }],
             generationConfig: {
                 maxOutputTokens: 100, // Limit response length
                 temperature: 0.2, // Make response more deterministic
             }
         };
     } else if (modelName.startsWith('gpt')) { // Covers gpt-4 etc.
         requestBody = {
             model: modelName, // Use the specific model name like 'gpt-4'
             messages: [{ role: "user", content: prompt }],
             max_tokens: 100, // Limit response length
             temperature: 0.2, // Make response more deterministic
         };
     } else {
          return { move: null, reason: `Prompt not implemented for model: ${modelName}` };
     }


    appendToLog(`${turn} AI (${modelName}) is thinking...`);
     isAITurn = true; // Set flag

    try {
        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (response.ok) {
            const data = await response.json();
            let responseText = '';

             // Extract response text based on model structure
             if (modelName.startsWith('gemini') && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
                 responseText = data.candidates[0].content.parts[0].text;
             } else if (modelName.startsWith('gpt') && data.choices && data.choices[0] && data.choices[0].message) {
                 responseText = data.choices[0].message.content;
             } else {
                 appendToLog(`Error: Unexpected API response structure from ${modelName}.`, 'error');
                 console.error('Unexpected response structure:', data);
                 isAITurn = false;
                 return { move: null, reason: 'Unexpected API response format.' };
             }

            appendToLog(`Raw AI Response: ${responseText}`);

            // --- Parse AI Response ---
            const moveMatch = responseText.match(/MOVE:\s*([a-h][1-8][a-h][1-8][qrbn]?)/i);
            const reasonMatch = responseText.match(/REASON:\s*(.*)/is); // 's' flag allows '.' to match newline

            const move = moveMatch ? moveMatch[1].toLowerCase() : null;
            const reason = reasonMatch ? reasonMatch[1].trim() : 'No reason provided.';

            if (move) {
                 appendToLog(`AI Proposed Move: ${move}`);
                 appendToLog(`AI Reason: ${reason}`, true);
                 isAITurn = false; // Reset flag
                 return { move: move, reason: reason };
            } else {
                 appendToLog(`Error: Could not parse move from AI response for ${modelName}.`, 'error');
                 isAITurn = false;
                 return { move: null, reason: `Failed to parse move from AI response: ${responseText}` };
            }


        } else {
            const errorData = await response.json();
            const errorMessage = `API Error from ${modelName}: ${response.status} ${response.statusText}`;
            appendToLog(errorMessage, 'error');
            console.error(errorMessage, errorData);
             isAITurn = false;
            return { move: null, reason: errorMessage };
        }
    } catch (error) {
        const errorMessage = `Network Error during API call for ${modelName}: ${error.message}`;
        appendToLog(errorMessage, 'error');
        console.error(errorMessage, error);
         isAITurn = false;
        return { move: null, reason: errorMessage };
    }
}


// --- Game Logic ---

function onDrop(source, target) {
    if (!gameStarted || isAITurn) {
        return 'snapback'; // Don't allow human moves if game not started or it's AI's turn
    }

    // Human move (not applicable in AI vs AI, but needed for chessboard.js)
    // In this AI vs AI setup, onDrop should ideally not be reachable if isAITurn check works.
    // However, we include it for completeness if you were to add human players.
    // For AI vs AI, pieces should not be draggable by the user.
    // Let's disable dragging after game starts for AI vs AI.
    return 'snapback'; // Always snapback as user shouldn't move in AI vs AI
}


function onSnapEnd() {
    // This event fires after a piece snap animation finishes
    board.position(game.fen()); // Update board position after the move animation
    checkGameStatus();
     // If the move was legal and the game is not over, trigger the next AI move
    if (gameStarted && !game.isGameOver() && !isAITurn) {
         // A short delay before the next AI move to make it feel less immediate
         setTimeout(triggerAIMove, 500);
     }
}

function checkGameStatus() {
    if (game.isCheckmate()) {
        appendToLog(`Game Over: Checkmate! ${game.turn() === 'w' ? 'Black' : 'White'} wins.`, 'success');
        gameStarted = false;
        enableControls(); // Re-enable controls to start a new game
    } else if (game.isDraw()) {
        appendToLog('Game Over: Draw!', 'success');
         gameStarted = false;
         enableControls();
    } else if (game.isStalemate()) {
        appendToLog('Game Over: Stalemate!', 'success');
         gameStarted = false;
         enableControls();
    } else if (game.isThreefoldRepetition()) {
        appendToLog('Game Over: Threefold Repetition!', 'success');
         gameStarted = false;
         enableControls();
    } else if (game.isInsufficientMaterial()) {
        appendToLog('Game Over: Insufficient Material!', 'success');
         gameStarted = false;
         enableControls();
    } else {
        const turn = game.turn() === 'w' ? 'White' : 'Black';
        // appendToLog(`${turn}'s turn.`); // Avoid excessive turn logs
    }
}

async function triggerAIMove() {
     if (!gameStarted || game.isGameOver() || isAITurn) {
         return; // Don't trigger if game not started, over, or AI is already thinking
     }

     const currentTurn = game.turn(); // 'w' or 'b'
     const aiModel = currentTurn === 'w' ? ai1ModelSelect.value : ai2ModelSelect.value;
     const apiKey = apiKeyInput.value;

     // Handle Random AI separately
     if (aiModel === 'random') {
         isAITurn = true;
         appendToLog(`${currentTurn === 'w' ? 'White' : 'Black'} AI (Random) is thinking...`);
         // Simulate thinking time
         setTimeout(() => {
             const possibleMoves = game.moves();
             if (possibleMoves.length > 0) {
                 const randomMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
                  const moveResult = game.move(randomMove); // Apply the move

                  if (moveResult) {
                     board.position(game.fen());
                     appendToLog(`${currentTurn === 'w' ? 'White' : 'Black'} AI (Random) moved: ${moveResult.san}`, false); // Use SAN notation for log
                     appendToLog('Reason: Chose a random legal move.', true);
                     checkGameStatus();
                      isAITurn = false;
                      // If the next player is also AI, trigger their move
                     if (gameStarted && !game.isGameOver()) {
                          setTimeout(triggerAIMove, 500); // Short delay
                      }
                  } else {
                      // This shouldn't happen with game.moves(), but good practice
                      appendToLog(`Error: Random AI generated an illegal move! ${randomMove}`, 'error');
                       isAITurn = false;
                  }
             } else {
                  appendToLog(`Error: Random AI found no possible moves! This indicates a game logic issue.`, 'error');
                   isAITurn = false;
             }
         }, 500); // Simulate thinking time
         return; // Exit AI trigger function for random AI
     }


     // Handle LLM AI
     if (!apiKey && (aiModel !== 'random')) {
        appendToLog(`Error: API key is required for ${aiModel}.`, 'error');
        // Game cannot continue, maybe end game or indicate error state
        return;
     }

    const aiResponse = await getAIMove(game.fen(), aiModel, apiKey);

    if (aiResponse.move) {
        // Attempt to apply the AI's move
        const moveResult = game.move(aiResponse.move); // Use UCI directly

        if (moveResult) {
            board.position(game.fen()); // Update the board display
            // Log the move using SAN notation for readability
            appendToLog(`${currentTurn === 'w' ? 'White' : 'Black'} AI (${aiModel}) moved: ${moveResult.san}`, false);
            checkGameStatus(); // Check game status after the move
            // The onSnapEnd handler will call triggerAIMove again if needed after the animation
        } else {
            appendToLog(`Error: ${currentTurn === 'w' ? 'White' : 'Black'} AI (${aiModel}) proposed an illegal move: ${aiResponse.move}`, 'error');
            // What to do if AI makes an illegal move?
            // Option 1: End the game (simplest)
            appendToLog("Game ended due to AI making an illegal move.", 'error');
            gameStarted = false;
            enableControls();
            // Option 2: Ask AI again (more complex)
            // Option 3: Make a random legal move for the AI (potentially confusing)
        }
    } else {
        // Handle cases where getAIMove returned null (API error, parsing error)
        appendToLog(`AI move failed: ${aiResponse.reason}`, 'error');
        // Depending on severity, you might end the game
        appendToLog("Game ended due to AI move failure.", 'error');
        gameStarted = false;
        enableControls();
    }
    isAITurn = false; // Reset flag after attempt (success or failure)
}


function startGame() {
    const ai1 = ai1ModelSelect.value;
    const ai2 = ai2ModelSelect.value;
    const apiKey = apiKeyInput.value;
    const keyTested = keyStatusSpan.classList.contains('success');


    if (!keyTested && (ai1 !== 'random' || ai2 !== 'random')) {
        appendToLog('Please test your API key first.', 'error');
        return;
    }

     if (ai1 !== 'random' && !apiKey) {
         appendToLog(`API Key is required for ${ai1} (White).`, 'error');
         return;
     }

     if (ai2 !== 'random' && !apiKey) {
         appendToLog(`API Key is required for ${ai2} (Black).`, 'error');
         return;
     }


    // Reset game state and board
    game.reset();
    board.start();
    logContentDiv.innerHTML = '<p>Game started!</p>'; // Clear previous log
    gameStarted = true;
    disableControls();
    playNowButton.disabled = true; // Disable play button once game starts

    // Determine who goes first and trigger the first move
    // White always goes first in chess
    appendToLog("White's turn.");
    setTimeout(triggerAIMove, 500); // Trigger the first AI move after a short delay
}


// --- Event Listeners ---
testKeyButton.addEventListener('click', () => {
    testApiKey(apiKeyInput.value);
});

playNowButton.addEventListener('click', startGame);

// Optional: Disable play button if API key input changes after a successful test
apiKeyInput.addEventListener('input', () => {
     if (keyStatusSpan.classList.contains('success')) {
         updateStatus(keyStatusSpan, 'Key changed, re-test required.', '');
         playNowButton.disabled = true;
     }
});

// Optional: Disable play button if AI model selection changes after a successful test
ai1ModelSelect.addEventListener('change', () => {
    if (keyStatusSpan.classList.contains('success')) {
         updateStatus(keyStatusSpan, 'AI model changed, re-test key against this model.', '');
         playNowButton.disabled = true;
     }
});
ai2ModelSelect.addEventListener('change', () => {
    // No key test needed for the second AI selection, but good to indicate
    // that the combination is set.
    // For this AI vs AI example, the single key test is sufficient.
});


// --- Initialize Board ---
const boardConfig = {
    draggable: false, // Disable dragging as it's AI vs AI
    position: 'start',
    onDrop: onDrop, // Still need this defined, but won't be used due to draggable: false
    onSnapEnd: onSnapEnd // Crucial for board updates after game.move()
};

board = Chessboard('board', boardConfig);

// Make board responsive
window.addEventListener('resize', board.resize);

// Initial state
updateStatus(keyStatusSpan, 'Enter API Key and Test', '');
appendToLog('Select AI models and enter your API key.');
