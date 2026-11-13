/**
 * FPVGate Audio Announcer
 * 
 * Two-tier system for voice announcements:
 * 1. ElevenLabs pre-recorded audio (best quality, instant playback from SD card)
 * 2. Web Speech API (browser TTS fallback, quality varies by device)
 */

class AudioAnnouncer {
    constructor() {
        console.log('[AudioAnnouncer] Initializing...');
        console.log('[AudioAnnouncer] Page origin:', window.location.origin);
        console.log('[AudioAnnouncer] Page host:', window.location.host);
        
        this.audioQueue = [];
        this.isPlaying = false;
        this.audioEnabled = false;
        this.rate = 1.3;  // Faster playback for quicker announcements
        this.volume = 1.0;  // Volume 0.0-1.0
        
        // Voice directory mapping (new canonical names first, legacy names as fallback)
        this.voiceDirectories = {
            'default': ['voice_default_en', 'sounds_default'],   // Sarah (Energetic Female, en)
            'rachel': ['voice_rachel_en', 'sounds_rachel'],      // Rachel (Calm Female, en)
            'adam': ['voice_adam_en', 'sounds_adam'],            // Adam (Deep Male, en)
            'antoni': ['voice_antoni_en', 'sounds_antoni'],      // Antoni (Male, en)
            'matilda': ['voice_matilda_en', 'sounds_matilda'],   // Matilda (Warm Female, en)
            'de': ['voice_german_de', 'voice_de'],               // German
            'es': ['voice_spanish_es', 'voice_es'],              // Spanish
            'fr': ['voice_french_fr', 'voice_fr'],               // French
            'webspeech': []                                      // Web Speech only (no pre-recorded)
        };
        
        // Load selected voice from localStorage
        const storedVoice = localStorage.getItem('selectedVoice') || 'default';
        this.selectedVoice = this.normalizeVoiceSelection(storedVoice);
        if (this.selectedVoice !== storedVoice) {
            localStorage.setItem('selectedVoice', this.selectedVoice);
        }
        console.log('[AudioAnnouncer] Selected voice from localStorage:', this.selectedVoice);
        console.log('[AudioAnnouncer] Voice directories:', this.getVoiceDirectoryCandidates().join(', ') || 'Web Speech only');
        
        // Pre-recorded audio cache
        this.audioCache = new Map();
        this.preloadedAudios = new Set();
        this.audioSources = new Map();
        this.audioLoads = new Map();
        this.audioSourceBytes = 0;
        this.audioSourceGeneration = 0;
        this.maxAudioSourceBytes = 4 * 1024 * 1024;
        this.maxAudioSources = 192;
        this.decodedClips = new Map();
        this.decodedLoads = new Map();
        this.decodedBytes = 0;
        this.maxDecodedBytes = 16 * 1024 * 1024;
        this.lapPreload = null;
        this.decodeContext = null;
        this.lapPackReady = false;
        this.racePackMode = null;
        this.preloadTimer = null;
        this.userActivated = false;
        if (typeof document !== 'undefined') {
            const activate = () => {
                if (this.userActivated) return;
                this.userActivated = true;
                if (this.audioEnabled) this.unlockAudioContextMobile();
                this.requestAudioPreload();
            };
            document.addEventListener('pointerdown', activate, {once:true, passive:true});
            document.addEventListener('keydown', activate, {once:true});
        }
        
        // Single reusable Audio element for mobile compatibility
        // Mobile browsers restrict creating new Audio() without user gesture
        this.reusableAudio = null;
        this.audioUnlocked = false;
        
        // Check Web Speech API availability
        this.webSpeechAvailable = 'speechSynthesis' in window;
        if (this.webSpeechAvailable) {
            console.log('[AudioAnnouncer] Web Speech API available');
            // Pre-load voices (some browsers need this)
            speechSynthesis.getVoices();
            if (speechSynthesis.onvoiceschanged !== undefined) {
                speechSynthesis.onvoiceschanged = () => {
                    const voices = speechSynthesis.getVoices();
                    console.log('[AudioAnnouncer] Web Speech voices loaded:', voices.length);
                };
            }
        } else {
            console.warn('[AudioAnnouncer] Web Speech API not available');
        }
        
        console.log('[AudioAnnouncer] Initialized (audio disabled by default, call enable() to activate)');
    }

    normalizeVoiceSelection(voice) {
        const aliases = {
            'piper': 'default',
            'german': 'de',
            'spanish': 'es',
            'french': 'fr',
            'voice_de': 'de',
            'voice_es': 'es',
            'voice_fr': 'fr',
        };
        const normalized = aliases[voice] || voice;
        if (Object.prototype.hasOwnProperty.call(this.voiceDirectories, normalized)) {
            return normalized;
        }
        return 'default';
    }

    getVoiceDirectoryCandidates() {
        const voice = this.normalizeVoiceSelection(this.selectedVoice);
        return this.voiceDirectories[voice] || this.voiceDirectories.default;
    }

    getPrimaryVoiceDirectory() {
        const candidates = this.getVoiceDirectoryCandidates();
        return candidates.length > 0 ? candidates[0] : null;
    }

    async resolveAudioPath(audioPath) {
        if (!audioPath) return null;

        if (await this.hasPrerecordedAudio(audioPath)) {
            return audioPath;
        }

        const candidates = this.getVoiceDirectoryCandidates();
        if (candidates.length < 2) return null;

        const primary = candidates[0];
        const prefix = `${primary}/`;
        if (!audioPath.startsWith(prefix)) return null;

        const filename = audioPath.substring(prefix.length);
        for (let i = 1; i < candidates.length; i++) {
            const fallbackPath = `${candidates[i]}/${filename}`;
            if (await this.hasPrerecordedAudio(fallbackPath)) {
                return fallbackPath;
            }
        }

        return null;
    }

    async playVoiceFile(filename, overlapMs = 50) {
        const candidates = this.getVoiceDirectoryCandidates();
        for (const dir of candidates) {
            const candidatePath = `${dir}/${filename}`;
            if (await this.hasPrerecordedAudio(candidatePath)) {
                await this.playPrerecorded(candidatePath, overlapMs);
                return true;
            }
        }
        return false;
    }

    /**
     * Check if pre-recorded audio exists for this phrase
     */
    async hasPrerecordedAudio(audioPath) {
        return !!(await this.loadAudioSource(audioPath));
    }

    // Consume each response before playing. A GET used only as an existence
    // check left an unread download competing with the audio element's second
    // GET for the gate's single file-transfer slot.
    async loadAudioSource(audioPath) {
        const cached = this.audioSources.get(audioPath);
        if (cached) {
            this.audioSources.delete(audioPath);
            this.audioSources.set(audioPath, cached);
            return cached.url;
        }
        if (this.audioLoads.has(audioPath)) return this.audioLoads.get(audioPath);
        const generation = this.audioSourceGeneration;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const pending = (async () => {
            try {
                const response = await fetch(audioPath, { signal: controller.signal });
                if (!response.ok) {
                    if (response.body) await response.body.cancel();
                    return null;
                }
                const blob = await response.blob();
                if (generation !== this.audioSourceGeneration || !blob.size || blob.size > this.maxAudioSourceBytes) return null;
                while (this.audioSources.size >= this.maxAudioSources || this.audioSourceBytes + blob.size > this.maxAudioSourceBytes) {
                    // Keep race confirmations warm throughout a long race.
                    const oldest = [...this.audioSources.keys()].find(path => !/(?:^|\/)(gate_1|race_complete|race_stopped)\.mp3$/.test(path));
                    if (!oldest) return null;
                    const entry = this.audioSources.get(oldest);
                    URL.revokeObjectURL(entry.url);
                    this.audioSourceBytes -= entry.size;
                    this.audioSources.delete(oldest);
                    this.preloadedAudios.delete(oldest);
                }
                const url = URL.createObjectURL(blob);
                this.audioSources.set(audioPath, { url, size: blob.size, blob });
                this.audioSourceBytes += blob.size;
                this.preloadedAudios.add(audioPath);
                return url;
            } catch (error) {
                console.warn('[AudioAnnouncer] Audio download failed:', audioPath, error);
                return null;
            } finally {
                clearTimeout(timeout);
            }
        })();
        this.audioLoads.set(audioPath, pending);
        try {
            return await pending;
        } finally {
            if (this.audioLoads.get(audioPath) === pending) this.audioLoads.delete(audioPath);
        }
    }

    requestAudioPreload() {
        // Never add SD traffic to a cold page load or start browser audio without
        // a gesture. Give the UI requests time to settle after interaction.
        if (!this.audioEnabled || !this.userActivated || this.preloadTimer) return;
        this.preloadTimer = setTimeout(async () => {
            this.preloadTimer = null;
            if (!this.audioEnabled || !this.userActivated) return;
            if (window.fpvGateLoading) { this.requestAudioPreload(); return; }
            await this.preloadRaceAudio();
        }, 10000);
    }

    async waitForAudioBudget(generation) {
        while (this.audioEnabled && generation === this.audioSourceGeneration) {
            let available = false;
            if (!(typeof raceRunning !== 'undefined' && raceRunning)) {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);
                try {
                    const response = await fetch('/api/system/info', {signal:controller.signal});
                    if (response.ok) {
                        const state = await response.json();
                        available = state.heapFree >= 55000 && state.heapLargest >= 16000 && state.requestsNow <= 4;
                    } else if (response.body) await response.body.cancel();
                } catch (_) {}
                finally { clearTimeout(timeout); }
            }
            if (available) return true;
            this.updatePackStatus(typeof i18n !== 'undefined' ? i18n.t('settings.tts.pack_paused') : 'Recorded voice preparation paused while the gate is busy. Browser voice remains available.');
            await this.sleep(5000);
        }
        return false;
    }

    async preloadRaceAudio() {
        const primary = this.getPrimaryVoiceDirectory();
        if (!primary) return;
        const generation = this.audioSourceGeneration;
        // Sequential downloads avoid flooding the gate during page startup.
        for (const file of ['gate_1.mp3', 'race_complete.mp3', 'race_stopped.mp3']) {
            if (generation !== this.audioSourceGeneration) return;
            if (typeof document !== 'undefined' && !await this.waitForAudioBudget(generation)) return;
            await this.resolveAudioPath(`${primary}/${file}`);
        }
        if (!this.lapPreload && (window.OfflineAudioContext || window.webkitOfflineAudioContext)) {
            this.lapPreload = this.preloadLapAudio(generation).finally(() => {
                if (generation === this.audioSourceGeneration) this.lapPreload = null;
            });
        }
    }

    clearAudioSources() {
        ++this.audioSourceGeneration;
        for (const entry of this.audioSources.values()) URL.revokeObjectURL(entry.url);
        this.audioSources.clear();
        this.audioLoads.clear();
        this.audioSourceBytes = 0;
        this.preloadedAudios.clear();
        this.decodedClips.clear();
        this.decodedLoads.clear();
        this.decodedBytes = 0;
        this.lapPackReady = false;
        this.lapPreload = null;
        if (this.preloadTimer) clearTimeout(this.preloadTimer);
        this.preloadTimer = null;
        this.updatePackStatus('');
    }

    updatePackStatus(text) {
        const element = typeof document !== 'undefined' && document.getElementById('voicePackStatus');
        if (element) element.textContent = text;
        const raceStatus = typeof document !== 'undefined' && document.getElementById('raceVoiceStatus');
        if (raceStatus) raceStatus.textContent = this.racePackMode === false && this.getPrimaryVoiceDirectory()
            ? (typeof i18n !== 'undefined' ? i18n.t('settings.tts.pack_race_fallback') : 'This race uses the browser voice because the recorded pack was not ready at the start.') : text;
    }

    // Convert to mono at a common rate, trimming only external silence. A small
    // safety margin retains quiet consonants; silence inside a word is untouched.
    async decodeVoiceClip(filename) {
        const primary = this.getPrimaryVoiceDirectory();
        if (!primary) return null;
        const key = `${primary}/${filename}`;
        if (this.decodedClips.has(key)) return this.decodedClips.get(key);
        if (this.decodedLoads.has(key)) return this.decodedLoads.get(key);
        const generation = this.audioSourceGeneration;
        const pending = (async () => {
            const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            if (!Context) return null;
            const path = await this.resolveAudioPath(key);
            const entry = path && this.audioSources.get(path);
            if (!entry || generation !== this.audioSourceGeneration) return null;
            if (!this.decodeContext) this.decodeContext = new Context(1, 1, 22050);
            const decoded = await this.decodeContext.decodeAudioData(await entry.blob.arrayBuffer());
            const samples = new Float32Array(decoded.length);
            for (let ch = 0; ch < decoded.numberOfChannels; ++ch) {
                const data = decoded.getChannelData(ch);
                for (let i = 0; i < samples.length; ++i) samples[i] += data[i] / decoded.numberOfChannels;
            }
            let first = 0, last = samples.length - 1;
            const threshold = 0.003; // about -50 dBFS
            while (first < last && Math.abs(samples[first]) < threshold) ++first;
            while (last > first && Math.abs(samples[last]) < threshold) --last;
            if (first === last) return null;
            const margin = Math.round(decoded.sampleRate * 0.015);
            const clip = { samples: samples.slice(Math.max(0, first - margin), Math.min(samples.length, last + margin + 1)), sampleRate: decoded.sampleRate };
            if (generation !== this.audioSourceGeneration || clip.samples.byteLength > this.maxDecodedBytes) return null;
            while (this.decodedBytes + clip.samples.byteLength > this.maxDecodedBytes || this.decodedClips.size >= 192) {
                const oldest = this.decodedClips.keys().next().value;
                this.decodedBytes -= this.decodedClips.get(oldest).samples.byteLength;
                this.decodedClips.delete(oldest);
            }
            this.decodedClips.set(key, clip);
            this.decodedBytes += clip.samples.byteLength;
            return clip;
        })().catch(error => { console.warn('[AudioAnnouncer] Clip preparation failed:', filename, error); return null; });
        this.decodedLoads.set(key, pending);
        try { return await pending; }
        finally { if (this.decodedLoads.get(key) === pending) this.decodedLoads.delete(key); }
    }

    async preloadLapAudio(generation) {
        // One gate transfer at a time. Prepare common words first; each complete
        // phrase can use the pack as soon as its own words are ready.
        const files = ['point.mp3', ...Array.from({length: 21}, (_, n) => `num_${n}.mp3`), ...Array.from({length: 10}, (_, n) => `lap_${n + 1}.mp3`), ...Array.from({length: 79}, (_, n) => `num_${n + 21}.mp3`), ...Array.from({length: 40}, (_, n) => `lap_${n + 11}.mp3`)];
        for (let i = 0; i < files.length; ++i) {
            if (generation !== this.audioSourceGeneration || !this.audioEnabled) return;
            if (!await this.waitForAudioBudget(generation)) return;
            await this.decodeVoiceClip(files[i]);
            if (generation !== this.audioSourceGeneration) return;
            this.updatePackStatus(typeof i18n !== 'undefined' ? i18n.t('settings.tts.pack_preparing', { n: Math.round((i + 1) * 100 / files.length) }) : `Preparing recorded lap audio: ${Math.round((i + 1) * 100 / files.length)}%. Browser voice is used until each phrase is ready.`);
        }
        const primary = this.getPrimaryVoiceDirectory();
        this.lapPackReady = files.every(file => this.decodedClips.has(`${primary}/${file}`));
        this.updatePackStatus(typeof i18n !== 'undefined' ? i18n.t(this.lapPackReady ? 'settings.tts.pack_ready' : 'settings.tts.pack_incomplete') : 'Recorded lap audio prepared. Missing clips use the browser voice.');
    }

    numberFiles(value) {
        const text = String(value);
        if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
        const [whole, decimal] = text.split('.');
        const files = Number(whole) <= 99 ? [`num_${Number(whole)}.mp3`] : [...whole].map(n => `num_${n}.mp3`);
        if (decimal) {
            files.push('point.mp3');
            if (decimal.length === 2 && decimal[0] !== '0') files.push(`num_${Number(decimal)}.mp3`);
            else files.push(...[...decimal].map(n => `num_${n}.mp3`));
        }
        return files;
    }

    // Encode a complete utterance as one WAV for the existing mobile-unlocked
    // Audio element. No network requests or media restarts occur between words.
    sequenceWav(clips) {
        const rate = clips[0].sampleRate;
        if (clips.some(clip => clip.sampleRate !== rate)) throw new Error('Incompatible clip sample rates');
        const length = clips.reduce((sum, clip) => sum + clip.samples.length, 0);
        const bytes = new ArrayBuffer(44 + length * 2), view = new DataView(bytes);
        const text = (at, value) => [...value].forEach((ch, n) => view.setUint8(at + n, ch.charCodeAt(0)));
        text(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        text(36, 'data'); view.setUint32(40, length * 2, true);
        let offset = 44;
        for (const clip of clips) for (const sample of clip.samples) {
            const value = Math.max(-1, Math.min(1, sample));
            view.setInt16(offset, value * (value < 0 ? 32768 : 32767), true); offset += 2;
        }
        return new Blob([bytes], {type: 'audio/wav'});
    }

    beginRacePlayback() {
        if (this.racePackMode !== null) return;
        this.racePackMode = this.lapPackReady;
        if (!this.racePackMode && this.getPrimaryVoiceDirectory()) {
            this.updatePackStatus(typeof i18n !== 'undefined' ? i18n.t('settings.tts.pack_race_fallback') : 'This race uses the browser voice because the recorded pack was not ready at the start.');
        }
    }

    endRacePlayback() { this.racePackMode = null; }

    async playVoiceSequence(files) {
        if (!files || !this.audioEnabled || this.racePackMode === false) return false;
        const primary = this.getPrimaryVoiceDirectory();
        if (!primary) return false;
        let clips = files.map(file => this.decodedClips.get(`${primary}/${file}`));
        if (clips.some(clip => !clip)) {
            if (this.webSpeechAvailable) return false; // one full TTS call while warming
            clips = [];
            const generation = this.audioSourceGeneration;
            for (const file of files) {
                const clip = await this.decodeVoiceClip(file);
                if (!clip || !this.audioEnabled || generation !== this.audioSourceGeneration) return false;
                clips.push(clip);
            }
        }
        const url = URL.createObjectURL(this.sequenceWav(clips));
        try { await this.playPrerecorded('assembled-lap', 0, url); }
        catch (error) { console.warn('[AudioAnnouncer] Assembled playback failed:', error); return false; }
        finally { URL.revokeObjectURL(url); }
        return true;
    }

    /**
     * Play pre-recorded audio file with optimized playback and instant transitions
     * Uses reusable Audio element on mobile for better compatibility
     * @param {number} overlapMs - Milliseconds to resolve early for crossfade (default: 50ms)
     */
    async playPrerecorded(audioPath, overlapMs = 50, preparedSource = null) {
        const source = preparedSource || await this.loadAudioSource(audioPath);
        if (!source) throw new Error(`Audio unavailable: ${audioPath}`);
        return new Promise((resolve, reject) => {
            // Use reusable audio element if available (mobile compatibility)
            // This avoids creating new Audio() which can fail without user gesture
            const audio = this.reusableAudio || new Audio();
            
            // Reset any previous handlers
            audio.oncanplay = null;
            audio.ontimeupdate = null;
            audio.onended = null;
            audio.onerror = null;
            
            audio.preload = 'auto';
            audio.playbackRate = this.rate;
            audio.volume = this.volume;
            audio.preservesPitch = true;
            
            let resolved = false;
            const overlapSeconds = overlapMs / 1000;
            
            audio.ontimeupdate = () => {
                if (!resolved && audio.duration > 0 && audio.currentTime >= audio.duration - overlapSeconds) {
                    resolved = true;
                    resolve();
                }
            };
            
            audio.onended = () => {
                if (!resolved) {
                    resolved = true;
                    resolve();
                }
            };
            
            audio.onerror = (e) => {
                console.error('[AudioAnnouncer] Error loading/playing audio:', audioPath, e);
                resolved = true;
                reject(e);
            };
            
            // Set source and play
            audio.src = source;
            
            // Play when ready
            const playAudio = () => {
                audio.oncanplay = null;
                // Loading a new source can reset playbackRate; apply it when ready.
                audio.defaultPlaybackRate = this.rate;
                audio.playbackRate = this.rate;
                audio.play().then(() => {
                    console.log('[AudioAnnouncer] Playing:', audioPath);
                }).catch((err) => {
                    console.error('[AudioAnnouncer] Play failed:', audioPath, err.message);
                    if (!resolved) {
                        resolved = true;
                        reject(err);
                    }
                });
            };
            
            // If already ready, play immediately
            if (audio.readyState >= 3) {
                playAudio();
            } else {
                audio.oncanplay = playAudio;
            }
        });
    }

    /**
     * Resolve currently selected UI language for Web Speech
     */
    getCurrentLanguageCode() {
        const i18nLang = (typeof window !== 'undefined' && window.i18n && window.i18n.currentLang)
            ? window.i18n.currentLang
            : null;
        const storedLang = localStorage.getItem('fpvgate_lang');
        const htmlLang = document.documentElement?.lang;
        const browserLang = navigator.language;
        const raw = (i18nLang || storedLang || htmlLang || browserLang || 'en').toString().trim();
        const lang = raw.toLowerCase();

        if (lang.startsWith('zh')) return 'zh-CN';
        if (lang.startsWith('fr')) return 'fr-FR';
        if (lang.startsWith('es')) return 'es-ES';
        if (lang.startsWith('de')) return 'de-DE';
        if (lang.startsWith('en')) return 'en-US';

        return raw;
    }

    /**
     * Find a browser speech voice matching the requested language
     */
    selectWebSpeechVoice(languageCode, voices) {
        if (!voices || voices.length === 0) return null;

        const target = (languageCode || '').toLowerCase();
        const base = target.split('-')[0];

        return (
            voices.find((v) => v.lang && v.lang.toLowerCase() === target) ||
            voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(`${base}-`)) ||
            voices.find((v) => v.lang && v.lang.toLowerCase() === base) ||
            null
        );
    }
    /**
     * Generate speech using Web Speech API
     */
    async playWebSpeech(text) {
        return new Promise((resolve, reject) => {
            if (!('speechSynthesis' in window)) {
                console.error('[AudioAnnouncer] Web Speech API not supported');
                reject(new Error('Web Speech API not supported'));
                return;
            }
            
            const languageCode = this.getCurrentLanguageCode();
            const voices = speechSynthesis.getVoices();
            const matchedVoice = this.selectWebSpeechVoice(languageCode, voices);
            console.log('[AudioAnnouncer] Web Speech voices available:', voices.length, 'target lang:', languageCode);
            
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = this.rate;
            utterance.lang = languageCode;
            if (matchedVoice) {
                utterance.voice = matchedVoice;
                utterance.lang = matchedVoice.lang || languageCode;
                console.log('[AudioAnnouncer] Using Web Speech voice:', matchedVoice.name, matchedVoice.lang);
            } else {
                console.log('[AudioAnnouncer] No exact Web Speech voice match, using browser default for lang:', languageCode);
            }
            
            utterance.onstart = () => {
                console.log('[AudioAnnouncer] Web Speech started speaking:', text);
            };
            
            utterance.onend = () => {
                console.log('[AudioAnnouncer] Web Speech finished speaking');
                resolve();
            };
            
            utterance.onerror = (event) => {
                console.error('[AudioAnnouncer] Web Speech error:', event.error, event);
                reject(new Error('Web Speech error: ' + event.error));
            };
            
            // Add timeout in case speech never starts/ends
            const timeout = setTimeout(() => {
                console.warn('[AudioAnnouncer] Web Speech timeout - speech may have failed silently');
                resolve(); // Resolve anyway to not block the queue
            }, 10000);
            
            utterance.onend = () => {
                clearTimeout(timeout);
                console.log('[AudioAnnouncer] Web Speech finished speaking');
                resolve();
            };
            
            console.log('[AudioAnnouncer] Calling speechSynthesis.speak()...');
            speechSynthesis.speak(utterance);
        });
    }

    /**
     * Main speak function with intelligent fallback
     */
    async speak(text) {
        if (!this.audioEnabled) {
            console.log('[AudioAnnouncer] Audio disabled, skipping:', text);
            return;
        }
        
        // Strip HTML tags and normalize
        const cleanText = text.replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ');
        
        if (!cleanText) {
            console.warn('[AudioAnnouncer] Empty text after cleaning:', text);
            return;
        }
        
        console.log('[AudioAnnouncer] Speaking:', cleanText);
        
        // Check if Web Speech only mode is selected
        const selectedVoice = this.normalizeVoiceSelection(localStorage.getItem('selectedVoice') || 'default');
        this.selectedVoice = selectedVoice;
        const useWebSpeechOnly = (selectedVoice === 'webspeech');
        
        try {
            // If Web Speech is selected, use it exclusively
            if (useWebSpeechOnly) {
                console.log('[AudioAnnouncer] Web Speech mode selected');
                await this.playWebSpeech(cleanText);
                return;
            }
            
            // ElevenLabs voice selected - try pre-recorded files first
            // Check for different lap announcement formats
            // Format 1: "Pilot Lap X, time" (e.g., "Louis Lap 5, 12.34")
            const fullFormatMatch = cleanText.match(/^(.+?)\s+lap\s+(\d+)\s*,\s*([\d.]+)$/i);
            if (fullFormatMatch) {
                const pilot = fullFormatMatch[1].trim();
                const lapNumber = parseInt(fullFormatMatch[2]);
                const lapTime = parseFloat(fullFormatMatch[3]);
                console.log('[AudioAnnouncer] Detected full format lap announcement:', pilot, lapNumber, lapTime);
                await this.speakComplexWithPilot(pilot, lapNumber, lapTime);
                return;
            }
            
            // Format 2: "Lap X, time" (e.g., "Lap 5, 12.34")
            const lapTimeFormatMatch = cleanText.match(/^lap\s+(\d+)\s*,\s*([\d.]+)$/i);
            if (lapTimeFormatMatch) {
                const lapNumber = parseInt(lapTimeFormatMatch[1]);
                const lapTime = parseFloat(lapTimeFormatMatch[2]);
                console.log('[AudioAnnouncer] Detected lap+time format:', lapNumber, lapTime);
                await this.speakComplexLapTime(lapNumber, lapTime);
                return;
            }
            
            // Format 3: "Pilot, time" (e.g., "Louis, 12.34") - sync mode format
            const pilotTimeMatch = cleanText.match(/^(.+?),\s*([\d.]+)$/);
            if (pilotTimeMatch) {
                const pilot = pilotTimeMatch[1].trim();
                const lapTime = parseFloat(pilotTimeMatch[2]);
                console.log('[AudioAnnouncer] Detected pilot+time format:', pilot, lapTime);
                await this.speakPilotTime(pilot, lapTime);
                return;
            }
            
            // Format 4: "time" only (e.g., "12.34")
            const timeOnlyMatch = cleanText.match(/^([\d.]+)$/);
            if (timeOnlyMatch) {
                const lapTime = timeOnlyMatch[1];
                console.log('[AudioAnnouncer] Detected time-only format:', lapTime);
                await this.speakNumber(lapTime);
                return;
            }
            
            // Try pre-recorded audio (ElevenLabs)
            const audioPath = this.mapTextToAudio(cleanText);
            if (audioPath) {
                const resolvedAudioPath = await this.resolveAudioPath(audioPath);
                if (resolvedAudioPath) {
                    console.log('[AudioAnnouncer] ✓ Playing pre-recorded:', resolvedAudioPath);
                    await this.playPrerecorded(resolvedAudioPath);
                    return;
                } else {
                    console.log('[AudioAnnouncer] ✗ Pre-recorded audio not found in any configured voice directory, trying fallback');
                }
            } else {
                console.log('[AudioAnnouncer] No audio mapping found for:', cleanText);
            }
            
            // Fallback: Web Speech API (for when pre-recorded files are missing)
            if (this.webSpeechAvailable) {
                console.log('[AudioAnnouncer] Fallback: Using Web Speech API:', cleanText);
                await this.playWebSpeech(cleanText);
            } else {
                console.warn('[AudioAnnouncer] No audio method available for:', cleanText);
            }
            
        } catch (error) {
            console.error('[AudioAnnouncer] Speech error:', error, 'for text:', cleanText);
        }
    }

    /**
     * Map text to pre-recorded audio file path
     * Returns null if no mapping exists
     */
    mapTextToAudio(text) {
        // Get voice directory based on selection
        const voiceDir = this.getPrimaryVoiceDirectory();
        if (!voiceDir) return null;
        
        // Normalize text: lowercase, trim, remove extra whitespace
        const lower = text.toLowerCase().trim().replace(/\s+/g, ' ');
        
        // Race control phrases (exact matches)
        if (lower === 'arm your quad') return `${voiceDir}/arm_your_quad.mp3`;
        if (lower === 'starting on the tone in less than five') return `${voiceDir}/starting_tone.mp3`;
        if (lower === 'race complete') return `${voiceDir}/race_complete.mp3`;
        if (lower === 'race stopped') return `${voiceDir}/race_stopped.mp3`;
        if (lower.includes('gate 1')) return `${voiceDir}/gate_1.mp3`;
        
        // Test voice
        if (lower.startsWith('testing sound for pilot')) {
            const phoneticInput = document.getElementById('pphonetic');
            const pilotNameInput = document.getElementById('pname');
            const pilotName = (pilotNameInput?.value || '').toLowerCase().trim();
            if (pilotName) {
                return `${voiceDir}/test_sound_${pilotName}.mp3`;
            }
        }
        
        // Check for lap patterns (e.g., "lap 1", "lap 5", "pilot lap 5", etc.)
        // This handles: "lap 5", "pilot lap 5", "pilot lap 5, 12.34", etc.
        const lapMatch = lower.match(/lap\s+(\d+)/);
        if (lapMatch) {
            const lapNum = parseInt(lapMatch[1]);
            if (lapNum >= 1 && lapNum <= 50) {
                // Check if this is a simple "lap X" without pilot name
                if (lower === `lap ${lapNum}` || lower.startsWith(`lap ${lapNum}`)) {
                    return `${voiceDir}/lap_${lapNum}.mp3`;
                }
            }
        }
        
        // Pilot-specific phrases (configurable)
        const phoneticInput = document.getElementById('pphonetic');
        const pilotNameInput = document.getElementById('pname');
        const phoneticName = (phoneticInput?.value || pilotNameInput?.value || '').toLowerCase().trim();
        
        if (phoneticName) {
            const fileName = phoneticName.replace(/\s+/g, '_');
            
            // Check for pilot name + lap patterns
            if (lower.includes(phoneticName)) {
                if (lower.includes('2 laps') || lower.includes('2laps')) {
                    return `${voiceDir}/${fileName}_2laps.mp3`;
                }
                if (lower.includes('3 laps') || lower.includes('3laps')) {
                    return `${voiceDir}/${fileName}_3laps.mp3`;
                }
                if (lower.includes('lap') && !lower.match(/lap\s+\d+/)) {
                    // "pilot lap" but not "pilot lap 5"
                    return `${voiceDir}/${fileName}_lap.mp3`;
                }
            }
        }
        
        return null;  // No pre-recorded audio available
    }

    /**
     * Speak complex announcement with pilot name (e.g., "Louis Lap 5, 12.34")
     * Breaks it into pre-recorded chunks when possible
     */
    async speakComplexWithPilot(pilot, lapNumber, lapTime) {
        if (!this.audioEnabled) return;
        
        // Check if Web Speech only mode is selected
        const selectedVoice = this.normalizeVoiceSelection(localStorage.getItem('selectedVoice') || 'default');
        this.selectedVoice = selectedVoice;
        const useWebSpeechOnly = (selectedVoice === 'webspeech');
        
        // If Web Speech mode is selected, use it exclusively
        if (useWebSpeechOnly) {
            const fullText = `${pilot} Lap ${lapNumber}, ${lapTime}`;
            console.log('[AudioAnnouncer] Web Speech mode - speaking complex announcement:', fullText);
            await this.playWebSpeech(fullText);
            return;
        }
        
        // ElevenLabs voice - try pre-recorded files first
        const phoneticInput = document.getElementById('pphonetic');
        const pilotNameInput = document.getElementById('pname');
        const phoneticName = (phoneticInput?.value || pilotNameInput?.value || pilot).toLowerCase().trim();
        const fileName = phoneticName.replace(/\s+/g, '_');
        
        const number = this.numberFiles(lapTime.toFixed(2));
        if (number && await this.playVoiceSequence([`${fileName}_lap.mp3`, ...this.numberFiles(lapNumber), ...number])) return;
        // Pilot-specific phrases are optional; warm them for a later call.
        if (this.audioEnabled) this.decodeVoiceClip(`${fileName}_lap.mp3`);

        // Fallback: Use Web Speech API
        const fullText = `${pilot} Lap ${lapNumber}, ${lapTime}`;
        console.log('[AudioAnnouncer] Using Web Speech fallback for:', fullText);
        if (this.webSpeechAvailable) {
            await this.playWebSpeech(fullText);
        }
    }
    
    /**
     * Speak pilot name + time (e.g., "Louis, 12.34") - sync mode format
     * Uses single Web Speech call for fastest announcement
     */
    async speakPilotTime(pilot, lapTime) {
        if (!this.audioEnabled) return;
        
        // Always use single Web Speech call for pilot+time (fastest, no file lookups)
        const fullText = `${pilot}, ${lapTime}`;
        console.log('[AudioAnnouncer] Speaking pilot+time:', fullText);
        if (this.webSpeechAvailable) {
            await this.playWebSpeech(fullText);
        }
    }

    /**
     * Speak lap announcement without pilot name (e.g., "Lap 5, 12.34")
     */
    async speakComplexLapTime(lapNumber, lapTime) {
        if (!this.audioEnabled) return;
        
        // Check if Web Speech only mode is selected
        const selectedVoice = this.normalizeVoiceSelection(localStorage.getItem('selectedVoice') || 'default');
        this.selectedVoice = selectedVoice;
        const useWebSpeechOnly = (selectedVoice === 'webspeech');
        
        // If Web Speech mode is selected, use it exclusively
        if (useWebSpeechOnly) {
            const fullText = `Lap ${lapNumber}, ${lapTime}`;
            console.log('[AudioAnnouncer] Web Speech mode - speaking lap+time:', fullText);
            await this.playWebSpeech(fullText);
            return;
        }
        
        // ElevenLabs voice - try pre-recorded files first
        const files = this.numberFiles(lapTime.toFixed(2));
        if (files && lapNumber >= 1 && lapNumber <= 50 && await this.playVoiceSequence([`lap_${lapNumber}.mp3`, ...files])) return;

        // Fallback: Use Web Speech API
        const fullText = `Lap ${lapNumber}, ${lapTime}`;
        console.log('[AudioAnnouncer] Using Web Speech fallback for:', fullText);
        if (this.webSpeechAvailable) {
            await this.playWebSpeech(fullText);
        }
    }

    /**
     * Speak a number naturally (e.g., 11.44 -> "eleven point forty-four")
     * Supports numbers 0-99 as words
     */
    async speakNumber(num) {
        const numStr = num.toString();
        console.log('[AudioAnnouncer] Speaking number:', numStr);
        
        // Check if Web Speech only mode is selected
        const selectedVoice = this.normalizeVoiceSelection(localStorage.getItem('selectedVoice') || 'default');
        this.selectedVoice = selectedVoice;
        const useWebSpeechOnly = (selectedVoice === 'webspeech');
        
        // If Web Speech mode is selected, use it exclusively
        if (useWebSpeechOnly) {
            console.log('[AudioAnnouncer] Web Speech mode - speaking number:', numStr);
            if (this.webSpeechAvailable) {
                await this.playWebSpeech(numStr);
            }
            return;
        }
        if (await this.playVoiceSequence(this.numberFiles(numStr))) return;
        if (this.webSpeechAvailable) await this.playWebSpeech(numStr);
    }

    /**
     * Queue speech to prevent overlapping
     */
    queueSpeak(text) {
        if (!this.audioEnabled) {
            console.log('[AudioAnnouncer] Audio disabled, not queuing:', text);
            return;
        }
        this.audioQueue.push(text);
        console.log('[AudioAnnouncer] Queued speech:', text, '(queue length:', this.audioQueue.length + ')');
        this.processQueue();
    }

    /**
     * Process the speech queue
     */
    async processQueue() {
        if (this.isPlaying || this.audioQueue.length === 0) {
            return;
        }
        
        this.isPlaying = true;
        
        try {
            while (this.audioQueue.length > 0 && this.audioEnabled) {
                const text = this.audioQueue.shift();
                try {
                    await this.speak(text);
                } catch (e) {
                    console.error('[AudioAnnouncer] Error in queue processing, continuing:', e);
                    // Continue processing queue even if one item fails
                }
                // No gap between queued announcements for faster playback
            }
        } finally {
            // Always set isPlaying to false, even if there's an error
            this.isPlaying = false;
        }
    }

    /**
     * Set speech rate (0.1 to 2.0)
     */
    setRate(rate) {
        this.rate = parseFloat(rate);
    }
    
    /**
     * Change voice and clear audio cache
     */
    setVoice(voice) {
        const normalizedVoice = this.normalizeVoiceSelection(voice);
        if (normalizedVoice === this.selectedVoice) {
            localStorage.setItem('selectedVoice', normalizedVoice);
            return; // Config polling must not throw away a warming/ready pack.
        }
        console.log('[AudioAnnouncer] Changing voice to:', normalizedVoice);
        this.selectedVoice = normalizedVoice;
        localStorage.setItem('selectedVoice', normalizedVoice);
        
        // Clear audio cache so new voice files are loaded
        this.audioCache.clear();
        this.clearAudioSources();
        if (this.audioEnabled) this.requestAudioPreload();
        
        console.log('[AudioAnnouncer] Voice changed, cache cleared');
    }

    /**
     * Enable audio announcements
     */
    async enable() {
        this.audioEnabled = true;
        console.log('[AudioAnnouncer] Audio enabled');
        this.requestAudioPreload();
        
        // Mobile browsers require audio to be "unlocked" with user interaction
        if (this.userActivated || (typeof navigator !== 'undefined' && navigator.userActivation?.isActive)) {
            this.userActivated = true;
            await this.unlockAudioContextMobile();
            this.requestAudioPreload();
        }
        
        // Start keepalive for desktop browsers to prevent cold-start delays
        this.startSpeechKeepalive();
        
        this.processQueue();  // Start processing any queued items
    }
    
    /**
     * Keep speech synthesis engine warm to prevent cold-start delays on desktop
     * Desktop browsers have 2-3 second delays if speech engine goes idle
     */
    startSpeechKeepalive() {
        // Clear any existing keepalive
        if (this.keepaliveInterval) {
            clearInterval(this.keepaliveInterval);
        }
        
        // Speak silent utterance every 10 seconds when idle
        this.keepaliveInterval = setInterval(() => {
            if (!this.audioEnabled || this.isPlaying || this.audioQueue.length > 0) {
                return; // Don't interfere with actual speech
            }
            
            // Speak empty/silent utterance to keep engine warm
            if ('speechSynthesis' in window) {
                const silentUtterance = new SpeechSynthesisUtterance('');
                silentUtterance.volume = 0;
                speechSynthesis.speak(silentUtterance);
            }
        }, 10000);
        
        console.log('[AudioAnnouncer] Speech keepalive started');
    }
    
    /**
     * Unlock audio context for mobile browsers
     * Mobile browsers require user interaction before playing audio
     */
    async unlockAudioContextMobile() {
        // Detect mobile/touch devices (broader detection than just iOS)
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
                        ('ontouchstart' in window);
        
        console.log('[AudioAnnouncer] Mobile detection:', isMobile, 'UA:', navigator.userAgent.substring(0, 50));
        console.log('[AudioAnnouncer] Origin:', window.location.origin, 'Host:', window.location.host);
        
        // Always try to unlock on mobile, but also try on desktop for safety
        console.log('[AudioAnnouncer] Attempting audio unlock...');
        
        try {
            // Create the reusable Audio element during user gesture
            // This is critical for mobile - Audio elements created during user gestures
            // can be reused for playback later without additional gestures
            if (!this.reusableAudio) {
                this.reusableAudio = new Audio();
                console.log('[AudioAnnouncer] Created reusable Audio element');
            }
            
            // Unlock by playing a silent sound
            this.reusableAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
            this.reusableAudio.volume = 0.01; // Tiny volume instead of 0 (some browsers ignore 0)
            
            // Try to play the reusable element to unlock it
            const playResult = await this.reusableAudio.play().then(() => {
                this.audioUnlocked = true;
                return 'success';
            }).catch(err => {
                // Even if play fails, mark as attempted so we don't keep trying
                this.audioUnlocked = true; // Treat as "attempted" - Web Speech might still work
                return err.message || 'unknown error';
            });
            console.log('[AudioAnnouncer] Reusable audio unlock result:', playResult);
            
            // For Web Speech API - try to initialize
            if ('speechSynthesis' in window) {
                // Cancel any pending speech first
                speechSynthesis.cancel();
                
                // Load voices (required for iOS)
                let voices = speechSynthesis.getVoices();
                console.log('[AudioAnnouncer] Initial voices count:', voices.length);
                
                if (voices.length === 0) {
                    // Voices not loaded yet, wait for them
                    await new Promise(resolve => {
                        const voiceTimeout = setTimeout(() => {
                            console.warn('[AudioAnnouncer] Voice loading timeout (1.5s)');
                            resolve();
                        }, 1500);
                        
                        if (speechSynthesis.onvoiceschanged !== undefined) {
                            speechSynthesis.onvoiceschanged = () => {
                                clearTimeout(voiceTimeout);
                                resolve();
                            };
                        } else {
                            clearTimeout(voiceTimeout);
                            resolve();
                        }
                    });
                    
                    voices = speechSynthesis.getVoices();
                }
                
                console.log('[AudioAnnouncer] Final voices count:', voices.length);
                
                // Try a silent utterance to fully unlock Web Speech
                if (voices.length > 0) {
                    const silentUtterance = new SpeechSynthesisUtterance('');
                    silentUtterance.volume = 0;
                    speechSynthesis.speak(silentUtterance);
                    console.log('[AudioAnnouncer] Silent utterance queued for unlock');
                }
            }
            
            console.log('[AudioAnnouncer] Audio unlock completed');
        } catch (error) {
            console.warn('[AudioAnnouncer] Audio unlock error:', error);
        }
    }

    /**
     * Disable audio announcements
     */
    disable() {
        this.audioEnabled = false;
        this.audioQueue = [];
        if (this.preloadTimer) clearTimeout(this.preloadTimer);
        this.preloadTimer = null;
        
        // Stop keepalive
        if (this.keepaliveInterval) {
            clearInterval(this.keepaliveInterval);
            this.keepaliveInterval = null;
        }
        
        // Stop any ongoing speech
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel();
        }
    }

    /**
     * Set volume for all audio (0.0-1.0)
     */
    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        console.log('[AudioAnnouncer] Volume set to:', this.volume);
        
        // Update cached audio elements
        for (const audio of this.audioCache.values()) {
            audio.volume = this.volume;
        }
    }

    /**
     * Check if currently speaking
     */
    isSpeaking() {
        return this.isPlaying;
    }

    /**
     * Clear the queue
     */
    clearQueue() {
        this.audioQueue = [];
    }

    /**
     * Helper: sleep function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Test function to verify audio files are accessible
     * Call this from browser console: audioAnnouncer.testAudioFiles()
     */
    async testAudioFiles() {
        console.log('[AudioAnnouncer] Testing audio file accessibility...');
        const testFiles = [];
        const voiceDirs = this.getVoiceDirectoryCandidates();
        for (const dir of voiceDirs) {
            testFiles.push(
                `${dir}/arm_your_quad.mp3`,
                `${dir}/starting_tone.mp3`,
                `${dir}/race_complete.mp3`,
                `${dir}/race_stopped.mp3`,
                `${dir}/lap_1.mp3`,
                `${dir}/lap_5.mp3`,
                `${dir}/num_0.mp3`,
                `${dir}/num_1.mp3`,
                `${dir}/point.mp3`
            );
        }
        
        const phoneticInput = document.getElementById('pphonetic');
        const pilotNameInput = document.getElementById('pname');
        const phoneticName = (phoneticInput?.value || pilotNameInput?.value || '').toLowerCase().trim();
        if (phoneticName) {
            const fileName = phoneticName.replace(/\s+/g, '_');
            for (const dir of voiceDirs) {
                testFiles.push(`${dir}/${fileName}_lap.mp3`);
            }
        }
        
        let found = 0;
        let missing = 0;
        
        for (const file of testFiles) {
            const exists = await this.hasPrerecordedAudio(file);
            if (exists) {
                found++;
                console.log('✓', file);
            } else {
                missing++;
                console.error('✗', file, '- NOT FOUND');
            }
        }
        
        console.log(`[AudioAnnouncer] Test complete: ${found} found, ${missing} missing`);
        return { found, missing, total: testFiles.length };
    }
}

// Export for use in script.js
window.AudioAnnouncer = AudioAnnouncer;
