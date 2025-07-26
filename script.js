(() => {
  // Grab elements
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const healthEl = document.getElementById('health');
  const gameOverOverlay = document.getElementById('gameOverOverlay');
  // Grab the title element within the overlay so we can change the
  // message for wins vs losses.
  const gameOverTitleEl = gameOverOverlay.querySelector('h1');
  const finalScoreEl = document.getElementById('finalScore');
  const restartButton = document.getElementById('restartButton');

  let missiles = [];
  let lastSpawnTime = 0;
  let spawnInterval = 2000; // ms between spawns; decreases over time
  let spawnDecay = 0.995; // factor to decrease spawnInterval each spawn
  let lastTimestamp = 0;
  let score = 0;
  let health = 100;
  let level = 1;
  let gameOver = false;
  let starField = [];
  // Explosion effects array. Each entry will store properties of
  // an explosion such as position, current radius, maximum radius,
  // and opacity. Explosions expand and fade out over a short
  // duration.
  let explosions = [];

  // Background music tracks.  The player has provided several
  // cyberpunk‑style MP3 files which are bundled with the game.  We
  // randomly select one track at a time and play it.  When it
  // finishes, a new random track is chosen so the soundtrack is
  // varied.  Tracks continue playing even when the game is over to
  // maintain atmosphere.
  const bgMusicFiles = [
    'teleporting-cyberpunk-music-230628.mp3',
    'cyberpunk-music-277931.mp3',
    'cyberpunk-futuristic-city-music-323171.mp3'
  ];
  const bgTracks = bgMusicFiles.map(path => {
    const audio = new Audio(path);
    audio.loop = false;
    audio.volume = 0.4; // moderate volume so as not to overpower effects
    return audio;
  });
  // Keep track of the currently playing track so we can pause it if
  // necessary.
  let currentBgTrack = null;

  /**
   * Spawn an explosion effect at the specified location. The initial
   * radius is zero and it expands to a maximum radius over 0.3 seconds
   * while fading out. The scale of the explosion can be tuned via
   * maxRadius.
   *
   * @param {number} x - x-coordinate of the explosion center in canvas
   * coordinate space (CSS pixels).
   * @param {number} y - y-coordinate of the explosion center in canvas
   * coordinate space (CSS pixels).
   * @param {number} baseRadius - base radius of the originating missile to
   * determine explosion size. If not provided, a default value is used.
   */
  function createExplosion(x, y, baseRadius = 20) {
    const explosion = {
      x,
      y,
      radius: 0,
      maxRadius: baseRadius * 3.0,
      alpha: 1.0,
      duration: 800, // milliseconds (lengthen duration for visibility)
      elapsed: 0
    };
    explosions.push(explosion);
  }

  // Create a single AudioContext for sound effects. Using one shared
  // context is more efficient and avoids concurrent contexts on
  // repeated clicks. Some browsers (especially mobile) require
  // AudioContext to be created in response to a user gesture; this
  // context will be instantiated lazily on the first call to
  // playExplosionSound().
  let audioCtx = null;

  /**
   * Play a random background track from the loaded MP3 files.  This
   * helper picks a track at random, stops any existing playback,
   * resets the new track to its beginning, and plays it.  When
   * the track ends, the function recursively selects another track
   * to continue the soundtrack indefinitely.  Called by
   * startBackgroundMusic() and by each track’s ended handler.
   */
  function playRandomBgTrack() {
    // Pause and detach any previously playing track.
    if (currentBgTrack) {
      try {
        currentBgTrack.pause();
      } catch (e) {}
      currentBgTrack.onended = null;
      currentBgTrack = null;
    }
    // Choose a random track from the list
    const nextIndex = Math.floor(Math.random() * bgTracks.length);
    const track = bgTracks[nextIndex];
    currentBgTrack = track;
    try {
      track.currentTime = 0;
      track.play().catch(() => {});
    } catch (e) {
      // ignore any play() errors (autoplay restrictions etc.)
    }
    track.onended = () => {
      playRandomBgTrack();
    };
  }

  /**
   * Start playing background music.  A random track from the
   * provided MP3 files is chosen and played.  When it finishes
   * playing, a new random track is selected.  This ensures that
   * music continues indefinitely without repeating the same loop
   * every time.  The first call to this function should occur
   * after a user gesture (for example, clicking the restart button)
   * to satisfy browser autoplay policies.
   */
  function startBackgroundMusic() {
    // Immediately play a new random track.  If a track was
    // previously playing, pause it so only one track plays at a time.
    playRandomBgTrack();
  }

  /**
   * Stop any currently playing background track.  This does not
   * select or start a new track.  Music is intentionally left
   * running when the game ends, so this function should only be
   * called when restarting the soundtrack or when cleaning up.
   */
  function stopBackgroundMusic() {
    if (currentBgTrack) {
      try {
        currentBgTrack.pause();
      } catch (e) {}
      currentBgTrack.onended = null;
      currentBgTrack = null;
    }
  }

  /**
   * Play a low‑pitched hit sound when a missile collides with the Earth.
   * This uses a sawtooth waveform at a lower frequency than the
   * explosion effect to differentiate the two sounds.  The tone
   * quickly decays to silence.  Like playExplosionSound(), the
   * audio context is created lazily on first use.
   */
  function playHitSound() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    const now = audioCtx.currentTime;
    // Start at a moderately low frequency and drop lower
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.25);
    // Quick volume envelope
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /**
   * Play a simple explosion-like sound effect. This uses the
   * Web Audio API to synthesise a short burst that ramps down
   * quickly. Because downloading external audio resources can be
   * unreliable or require user authentication, this synthesised
   * effect provides audible feedback without loading any files.
   */
  function playExplosionSound() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Create an oscillator and gain node for the effect.
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.type = 'square';
    // Start at a relatively high frequency and exponentially ramp down
    // to simulate an explosion decay.
    const now = audioCtx.currentTime;
    oscillator.frequency.setValueAtTime(300, now);
    oscillator.frequency.exponentialRampToValueAtTime(50, now + 0.3);
    // Control the volume envelope; ramp down quickly for a short pop.
    gainNode.gain.setValueAtTime(0.8, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.3);
  }

  // Generate star positions (percentage values so they scale with canvas)
  function generateStars(count) {
    starField = [];
    for (let i = 0; i < count; i++) {
      starField.push({
        x: Math.random(),
        y: Math.random(),
        brightness: 0.5 + Math.random() * 0.5,
        size: 0.5 + Math.random() * 1.5
      });
    }
  }

  // Missile constructor
  function createMissile() {
    const radius = 15 + Math.random() * 10;
    // Spawn missiles based on the canvas’s drawing buffer dimensions to
    // ensure consistency with hit detection.  Using canvas.width
    // instead of canvas.clientWidth avoids discrepancies on high DPI
    // displays or when CSS styling affects the canvas size.
    const x = radius + Math.random() * (canvas.width - radius * 2);
    const speed = 40 + Math.random() * 30 + score * 1.0; // increase speed based on score
    missiles.push({ x, y: -radius, radius, speed });
  }

  // Resize the canvas and re-generate stars
  function resizeCanvas() {
    // Use a one‑to‑one pixel mapping for the canvas.  High DPI
    // displays might render the game slightly less sharp, but it
    // greatly simplifies hit detection because CSS and canvas
    // coordinates are identical.  Avoid scaling by device pixel ratio.
    const { innerWidth: width, innerHeight: height } = window;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.width = width;
    canvas.height = height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // regenerate stars for new canvas size
    generateStars(100);
  }

  // Draw star field background
  function drawStars() {
    // Clear the entire canvas with black to prevent residual artifacts.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Draw each star.  Stars’ x and y are defined as percentages of
    // the canvas dimensions, so multiply by canvas.width/height to
    // convert to pixel coordinates.
    for (const star of starField) {
      const x = star.x * canvas.width;
      const y = star.y * canvas.height;
      ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;
      ctx.beginPath();
      ctx.arc(x, y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw Earth at bottom with a more detailed look.  The Earth is drawn
  // as a semi‑circle using a radial gradient to suggest curvature
  // and several green shapes to represent simplified continents.
  function drawEarth() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    // Determine Earth radius relative to the smaller canvas dimension.  A
    // larger multiplier makes the Earth appear bigger on tall screens.
    const earthRadius = Math.min(width, height) * 0.4;
    // Center horizontally; vertically position the centre below the bottom
    // of the canvas so only the top half is visible.
    const centerX = width / 2;
    const centerY = height + earthRadius * 0.5;
    // Create a radial gradient: lighter near the top (sunlit) fading to
    // darker blue toward the bottom of the planet.
    const grad = ctx.createRadialGradient(
      centerX,
      centerY - earthRadius * 0.4,
      earthRadius * 0.1,
      centerX,
      centerY,
      earthRadius
    );
    grad.addColorStop(0, '#2e8bc0'); // light blue highlight
    grad.addColorStop(1, '#063c77'); // dark blue shadow
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, earthRadius, Math.PI, Math.PI * 2);
    ctx.fill();
    // Draw continents as simple polygon shapes.  Coordinates are
    // relative to the Earth radius; positive y values move up (toward
    // the top of the visible hemisphere).  These shapes are loosely
    // inspired by real continents but kept abstract.
    const continents = [
      // Rough representation of the Americas
      [
        [-0.3, -0.15],
        [-0.1, 0.1],
        [0.05, 0.0],
        [-0.05, -0.25],
        [-0.25, -0.3]
      ],
      // Rough representation of Eurasia/Africa
      [
        [0.05, 0.05],
        [0.25, 0.2],
        [0.35, 0.15],
        [0.3, -0.05],
        [0.1, -0.1],
        [0.0, -0.05]
      ]
    ];
    ctx.fillStyle = '#159447';
    continents.forEach(shape => {
      ctx.beginPath();
      shape.forEach((pt, idx) => {
        // Convert relative coordinates into canvas space.  The y
        // coordinate uses a negative multiplier because the y axis
        // increases downward in canvas.
        const px = centerX + pt[0] * earthRadius;
        const py = centerY - earthRadius + pt[1] * earthRadius;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
    });
  }

  // Draw a missile at its current position
  function drawMissile(missile) {
    ctx.save();
    ctx.translate(missile.x, missile.y);
    // draw body
    ctx.fillStyle = '#555';
    const bodyWidth = missile.radius * 0.4;
    const bodyHeight = missile.radius * 1.6;
    ctx.fillRect(-bodyWidth / 2, -bodyHeight / 2, bodyWidth, bodyHeight);
    // draw tip
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(-bodyWidth / 2, -bodyHeight / 2);
    ctx.lineTo(bodyWidth / 2, -bodyHeight / 2);
    ctx.lineTo(0, -bodyHeight);
    ctx.closePath();
    ctx.fill();
    // draw fins
    ctx.fillStyle = '#888';
    const finHeight = bodyHeight * 0.3;
    const finWidth = bodyWidth * 0.8;
    ctx.beginPath();
    ctx.moveTo(-bodyWidth / 2, bodyHeight / 2);
    ctx.lineTo(-bodyWidth / 2 - finWidth, bodyHeight / 2 + finHeight);
    ctx.lineTo(-bodyWidth / 2, bodyHeight / 2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bodyWidth / 2, bodyHeight / 2);
    ctx.lineTo(bodyWidth / 2 + finWidth, bodyHeight / 2 + finHeight);
    ctx.lineTo(bodyWidth / 2, bodyHeight / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Determine whether a given point lies within the drawn shape of a missile.
   * This function mirrors the drawing logic used in drawMissile() to build
   * a path for the missile (body, tip and fins) and then uses
   * CanvasRenderingContext2D.isPointInPath() to test whether the point
   * intersects the path.  The coordinates px and py should be in
   * canvas space (the same coordinate system used for missile.x and
   * missile.y).
   *
   * @param {Object} m The missile object with x, y and radius properties.
   * @param {number} px The x-coordinate of the point to test in canvas
   * space.
   * @param {number} py The y-coordinate of the point to test in canvas
   * space.
   * @returns {boolean} True if the point lies within the missile shape.
   */
  function pointInMissile(m, px, py) {
    // Compute dimensions consistent with drawMissile()
    const bodyWidth = m.radius * 0.4;
    const bodyHeight = m.radius * 1.6;
    const finHeight = bodyHeight * 0.3;
    const finWidth = bodyWidth * 0.8;
    // Save context state and translate to missile centre
    ctx.save();
    ctx.translate(m.x, m.y);
    // Build the composite path for the missile
    ctx.beginPath();
    // Body rectangle
    ctx.rect(-bodyWidth / 2, -bodyHeight / 2, bodyWidth, bodyHeight);
    // Tip triangle
    ctx.moveTo(-bodyWidth / 2, -bodyHeight / 2);
    ctx.lineTo(bodyWidth / 2, -bodyHeight / 2);
    ctx.lineTo(0, -bodyHeight);
    ctx.closePath();
    // Left fin
    ctx.moveTo(-bodyWidth / 2, bodyHeight / 2);
    ctx.lineTo(-bodyWidth / 2 - finWidth, bodyHeight / 2 + finHeight);
    ctx.lineTo(-bodyWidth / 2, bodyHeight / 2 + finHeight);
    ctx.closePath();
    // Right fin
    ctx.moveTo(bodyWidth / 2, bodyHeight / 2);
    ctx.lineTo(bodyWidth / 2 + finWidth, bodyHeight / 2 + finHeight);
    ctx.lineTo(bodyWidth / 2, bodyHeight / 2 + finHeight);
    ctx.closePath();
    // Determine if the global point (px, py) is inside the path.  Because
    // we applied a translation, the current transformation matrix maps
    // world coordinates to the missile’s local coordinate space.  The
    // isPointInPath() call automatically applies this transform when
    // performing the test.
    const hit = ctx.isPointInPath(px, py);
    // Restore context to undo the translation
    ctx.restore();
    return hit;
  }

  // Main game loop using requestAnimationFrame
  function gameLoop(timestamp) {
    if (gameOver) return;
    if (!lastTimestamp) lastTimestamp = timestamp;
    const delta = timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    // spawn missiles if enough time elapsed
    if (timestamp - lastSpawnTime > spawnInterval) {
      createMissile();
      lastSpawnTime = timestamp;
      // gradually increase difficulty by reducing spawn interval
      spawnInterval *= spawnDecay;
      if (spawnInterval < 400) spawnInterval = 400; // cap spawn speed
    }
    // Update missile positions
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      m.y += (m.speed * delta) / 1000;
      // Check if missile hits Earth.  Use canvas.height rather than
      // clientHeight to align with the drawing coordinate system.
      if (m.y - m.radius > canvas.height) {
        // Missile hit the Earth.  Apply damage based on the current
        // level.  At level 1 a small amount of damage is applied,
        // increasing by one per level.  Use Math.max to ensure
        // damage is at least 1.
        missiles.splice(i, 1);
        const damage = Math.max(1, level);
        health -= damage;
        // Play a distinct sound when a missile hits the Earth.
        playHitSound();
        updateHUD();
        if (health <= 0) {
          endGame(false);
          return;
        }
      }
    }
    // Draw scene
    drawStars();
    drawEarth();
    for (const m of missiles) {
      drawMissile(m);
    }

    // Update and draw explosions
    for (let i = explosions.length - 1; i >= 0; i--) {
      const exp = explosions[i];
      // Advance explosion timer
      exp.elapsed += delta;
      const progress = Math.min(exp.elapsed / exp.duration, 1);
      // Calculate radius and alpha based on progress
      exp.radius = exp.maxRadius * progress;
      exp.alpha = 1 - progress;
      // Draw explosion using a radial gradient for a more vivid effect
      ctx.save();
      // Create radial gradient: bright center fading to transparent edges
      const gradient = ctx.createRadialGradient(exp.x, exp.y, 0, exp.x, exp.y, exp.radius);
      // Inner color (bright yellow) scaled by alpha
      gradient.addColorStop(0, `rgba(255, 255, 200, ${0.8 * exp.alpha})`);
      // Mid color (orange)
      gradient.addColorStop(0.5, `rgba(255, 140, 0, ${0.5 * exp.alpha})`);
      // Outer edge fully transparent
      gradient.addColorStop(1, `rgba(255, 69, 0, 0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, exp.radius, 0, Math.PI * 2);
      ctx.fill();
      // Draw a bright core to make the explosion stand out
      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 255, 255, ${0.6 * exp.alpha})`;
      ctx.arc(exp.x, exp.y, exp.radius * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Remove explosion if its duration is over
      if (progress >= 1) {
        explosions.splice(i, 1);
      }
    }
    requestAnimationFrame(gameLoop);
  }

  // Update HUD
  function updateHUD() {
    scoreEl.textContent = `Score: ${score}`;
    // Display health and current level in the HUD.  Showing the
    // level helps players understand the increasing difficulty.
    healthEl.textContent = `Earth Health: ${Math.max(0, Math.floor(health))} | Level: ${level}`;
  }

  // Handle click/tap to destroy missiles
  function handlePointer(event) {
    if (gameOver) return;
    // Determine the pointer’s position relative to the canvas.
    // For mouse events we can use offsetX/offsetY, which are
    // coordinates relative to the target element.  For touch events
    // we compute the position from clientX/clientY and the
    // canvas bounding rectangle.
    let px, py;
    if (event.touches && event.touches.length > 0) {
      const rect = canvas.getBoundingClientRect();
      px = event.touches[0].clientX - rect.left;
      py = event.touches[0].clientY - rect.top;
    } else {
      px = event.offsetX;
      py = event.offsetY;
    }

    // Note: We intentionally avoid updating the HUD here.  The
    // scoreboard is updated only when a missile is destroyed or
    // when the game state changes.
    // Determine whether the pointer intersects any missile shape.
    // We first use the precise shape test defined in pointInMissile().
    // If no missile reports a hit, we fall back to a generous
    // radial approximation (2.5× radius) to make gameplay forgiving.
    let hitIndex = -1;
    for (let i = 0; i < missiles.length; i++) {
      const m = missiles[i];
      // Precise shape detection using the path of the missile.
      if (pointInMissile(m, px, py)) {
        hitIndex = i;
        break;
      }
    }
    // If no precise hit was found, attempt a radial proximity check.
    // We use a smaller multiplier than before to prevent destroying
    // missiles when clicking far away.  A moderate threshold still
    // allows for slightly imprecise taps on mobile without enabling
    // “destroy anywhere” behaviour.  There is no fixed minimum,
    // because using a large minimum allowed clicks anywhere on the
    // canvas to destroy the nearest missile.
    if (hitIndex === -1) {
      for (let i = 0; i < missiles.length; i++) {
        const m = missiles[i];
        const dx = px - m.x;
        const dy = py - m.y;
        // Compute hit radius as a multiple of the missile’s radius.
        // A factor of 3.0 strikes a balance between forgiving taps
        // (especially on touch screens) and preventing clicks far
        // from a missile from registering.  There is intentionally
        // no absolute minimum, as large minimum thresholds made
        // clicking anywhere destroy the nearest missile.
        const hitRadius = m.radius * 3.0;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
          hitIndex = i;
          break;
        }
      }
    }
    if (hitIndex !== -1) {
      const removed = missiles[hitIndex];
      missiles.splice(hitIndex, 1);
      score++;
      // Check for level advancement.  Every 10 points increases
      // the level.  We allow the level to exceed 10 (unboundedLevel)
      // so we can detect when the player has completed level 10.
      const unboundedLevel = Math.floor(score / 10) + 1;
      // If the player has progressed beyond level 10 (i.e., score >= 100),
      // trigger a win.  Level 10 must be completed to win.
      if (unboundedLevel > 10) {
        winGame();
        return;
      }
      const newLevel = Math.min(10, unboundedLevel);
      if (newLevel !== level) {
        level = newLevel;
        // Recalculate spawn interval to make missiles spawn faster
        // on higher levels.  Decrease the base interval by 10%
        // per level.
        spawnInterval = 2000 * Math.pow(0.9, level - 1);
      }
      updateHUD();
      createExplosion(removed.x, removed.y, removed.radius);
      playExplosionSound();
    }
  }

  // Game start
  function startGame() {
    missiles = [];
    explosions = [];
    lastSpawnTime = 0;
    // Reset spawn interval for level 1.  Later levels will
    // recalculate this interval based on the new level.
    spawnInterval = 2000;
    score = 0;
    health = 100;
    level = 1;
    gameOver = false;
    lastTimestamp = 0;
    updateHUD();
    gameOverOverlay.classList.add('hidden');
    // Start or restart the background music.  This will pick a
    // random track from the bundled MP3 files and begin playing it.
    // It should be invoked in response to a user interaction to
    // satisfy browser autoplay policies.
    startBackgroundMusic();
    requestAnimationFrame(gameLoop);
  }

  /**
   * End the game due to either loss (health depleted) or victory
   * (reaching the maximum level).  When win is true the overlay
   * displays a congratulatory message; otherwise it shows the
   * standard game over text.
   *
   * @param {boolean} win - If true, the player has won the game.
   */
  function endGame(win = false) {
    gameOver = true;
    // Update the overlay title based on win/lose state
    gameOverTitleEl.textContent = win ? 'You Win!' : 'Game Over';
    finalScoreEl.textContent = score;
    gameOverOverlay.classList.remove('hidden');
    // Do not stop the background music when the game ends.  Music
    // continues playing to maintain ambience on the game over screen.
  }

  // Helper for win condition; delegates to endGame() with win flag.
  function winGame() {
    endGame(true);
  }

  // Restart button handler
  restartButton.addEventListener('click', startGame);
  // Canvas click/touch events
  canvas.addEventListener('click', handlePointer);
  canvas.addEventListener('touchstart', handlePointer);
  // Resize handler
  window.addEventListener('resize', resizeCanvas);
  // Initialize
  resizeCanvas();
  startGame();
})();