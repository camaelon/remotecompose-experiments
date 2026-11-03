// ToneSynthesizer: ports the Java ToneSynthesizer. Produces a WAV (16-bit mono,
// little-endian PCM) Uint8Array from a frequency/duration/waveform spec.

export class ToneSynthesizer {
    static readonly SAMPLE_RATE = 22050;

    /**
     * Synthesize raw 16-bit little-endian mono PCM bytes.
     * waveform: 1=square, 2=sawtooth, 3=triangle, else=sine.
     */
    static synthesizePcm(
        frequency: number,
        durationSec: number,
        waveform: number,
        sampleRate: number
    ): Uint8Array {
        const sampleCount = Math.max(1, Math.floor(sampleRate * durationSec));
        const pcm = new Uint8Array(sampleCount * 2);
        const waveKind = Math.floor(waveform);

        for (let i = 0; i < sampleCount; i++) {
            const t = i / sampleRate;
            const phase = 2 * Math.PI * frequency * t;

            let sample: number;
            switch (waveKind) {
                case 1: // square
                    sample = Math.sin(phase) >= 0 ? 1 : -1;
                    break;
                case 2: // sawtooth
                    sample = 2 * (frequency * t - Math.floor(frequency * t + 0.5));
                    break;
                case 3: // triangle
                    sample = 2 * Math.abs(2 * (frequency * t - Math.floor(frequency * t + 0.5))) - 1;
                    break;
                default: // sine
                    sample = Math.sin(phase);
                    break;
            }

            let envelope: number;
            if (i < 100) {
                envelope = i / 100;
            } else if (i > sampleCount - 100) {
                envelope = (sampleCount - i) / 100;
            } else {
                envelope = 1;
            }

            // Cast to signed 16-bit.
            const s = (Math.round(sample * envelope * 32767) << 16) >> 16;
            pcm[2 * i] = s & 0xff;
            pcm[2 * i + 1] = (s >> 8) & 0xff;
        }

        return pcm;
    }

    /**
     * Wrap raw PCM bytes in a standard 44-byte RIFF/WAVE/fmt/data header
     * (little-endian) followed by the PCM data.
     */
    static buildWav(
        pcm: Uint8Array,
        sampleRate: number = ToneSynthesizer.SAMPLE_RATE,
        bitDepth: number = 16,
        channels: number = 1
    ): Uint8Array {
        const byteRate = (sampleRate * channels * bitDepth) / 8;
        const blockAlign = (channels * bitDepth) / 8;
        const dataSize = pcm.length;

        const out = new Uint8Array(44 + dataSize);
        const view = new DataView(out.buffer);
        const le = true;

        const writeStr = (offset: number, str: string) => {
            for (let i = 0; i < str.length; i++) {
                out[offset + i] = str.charCodeAt(i);
            }
        };

        writeStr(0, 'RIFF');
        view.setInt32(4, 36 + dataSize, le);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setInt32(16, 16, le);
        view.setInt16(20, 1, le); // PCM
        view.setInt16(22, channels, le);
        view.setInt32(24, sampleRate, le);
        view.setInt32(28, byteRate, le);
        view.setInt16(32, blockAlign, le);
        view.setInt16(34, bitDepth, le);
        writeStr(36, 'data');
        view.setInt32(40, dataSize, le);

        out.set(pcm, 44);
        return out;
    }

    /**
     * SoundExpression TYPE_SYNTH (11), an EXTENSION of the reference's tone: one note with an
     * ADSR envelope, an exponential pitch glide, vibrato, a pulse width, a one-pole low-pass
     * filter, frequency modulation (bells, chimes) and an echo. `p` holds params[1..], already
     * resolved; a missing or non-finite value takes its default (SYNTH_DEFAULTS). Waveforms as
     * the tone's, plus 4 = noise (a new random value each cycle of the frequency: white noise
     * at 22050 Hz and above, pitched below), from a fixed LCG so every player writes the same
     * samples. The volumes are a gain per channel (stereo when they differ) and the rate a
     * speed (pitch and times together).
     */
    static synthesizeSynthWav(p: ArrayLike<number>, leftGain: number, rightGain: number, rate: number): Uint8Array {
        const v = ToneSynthesizer.synthParams(p);
        const r = ToneSynthesizer.validRate(rate);
        const voice = ToneSynthesizer.voiceSamples(v, v[0], v[1], r);
        return ToneSynthesizer.toWav(ToneSynthesizer.echo(voice, v, r), leftGain, rightGain);
    }

    /**
     * SoundExpression TYPE_SEQUENCE (12), an EXTENSION: notes played by one synth voice,
     * mixed into one sound. `voice` is the synth's resolved params[1..]; `notes` holds
     * (start s, frequency Hz, duration s, gain) groups. A frequency of 0 or less is a rest.
     * Notes may overlap (a chord); the echo is the voice's, applied to the mix.
     */
    static synthesizeSequenceWav(voice: ArrayLike<number>, notes: ArrayLike<number>,
                                 leftGain: number, rightGain: number, rate: number): Uint8Array {
        const v = ToneSynthesizer.synthParams(voice);
        const r = ToneSynthesizer.validRate(rate);
        const sr = ToneSynthesizer.SAMPLE_RATE;
        const parts: [number, Float32Array, number][] = [];
        let total = 1;
        for (let k = 0; k + 3 < notes.length; k += 4) {
            const start = Math.max(0, num(notes[k], 0)) / r, f = num(notes[k + 1], 0);
            const dur = Math.max(0, num(notes[k + 2], 0)), gain = num(notes[k + 3], 1);
            if (!(f > 0) || dur <= 0 || gain === 0) continue;
            const at = Math.round(start * sr);
            if (at >= ToneSynthesizer.MAX_SAMPLES) continue;
            const samples = ToneSynthesizer.voiceSamples(v, f, dur, r);
            parts.push([at, samples, gain]);
            total = Math.max(total, at + samples.length);
        }
        const mix = new Float32Array(Math.min(total, ToneSynthesizer.MAX_SAMPLES));
        for (const [at, samples, gain] of parts) {
            const n = Math.min(samples.length, mix.length - at);
            for (let i = 0; i < n; i++) mix[at + i] += samples[i] * gain;
        }
        return ToneSynthesizer.toWav(ToneSynthesizer.echo(mix, v, r), leftGain, rightGain);
    }

    /** TYPE_SYNTH defaults, by position after the type tag. */
    static readonly SYNTH_DEFAULTS = [
        440,    // 1 frequency (Hz)
        0.2,    // 2 duration (s): held, before the release
        0,      // 3 waveform: 0 sine, 1 square, 2 sawtooth, 3 triangle, 4 noise
        0.005,  // 4 attack (s)
        0,      // 5 decay (s)
        1,      // 6 sustain level (0..1)
        0.05,   // 7 release (s)
        0,      // 8 frequencyEnd (Hz): glide to it over the duration; 0 = none
        0,      // 9 vibrato rate (Hz)
        0,      // 10 vibrato depth (semitones)
        0.5,    // 11 pulse width (square, 0..1)
        0,      // 12 low-pass cutoff (Hz): 0 = off
        0,      // 13 FM ratio: modulator frequency / frequency; 0 = no FM
        0,      // 14 FM index (radians of phase deviation), scaled by the envelope
        0,      // 15 echo delay (s): 0 = no echo
        0.4,    // 16 echo feedback (0..0.95)
    ];

    /** The longest sound written: 30 seconds. */
    static readonly MAX_SAMPLES = ToneSynthesizer.SAMPLE_RATE * 30;

    private static synthParams(p: ArrayLike<number>): number[] {
        return ToneSynthesizer.SYNTH_DEFAULTS.map((d, i) => num(i < p.length ? p[i] : NaN, d));
    }

    private static validRate(rate: number): number {
        return rate > 0 && Number.isFinite(rate) ? rate : 1;
    }

    /** One note of the voice `v` at frequency `freq`, held `hold` seconds: mono, -1..1. */
    private static voiceSamples(v: number[], freq: number, hold: number, rate: number): Float32Array {
        const sr = ToneSynthesizer.SAMPLE_RATE;
        const f0 = Math.max(0, freq) * rate, wave = Math.floor(v[2]);
        const attack = Math.max(0, v[3]) / rate, decay = Math.max(0, v[4]) / rate;
        const sustain = Math.min(1, Math.max(0, v[5])), release = Math.max(0, v[6]) / rate;
        // A percussive voice (sustain 0: a bell, a pluck) rings through its attack and decay
        // whatever the note's duration, as a struck note does.
        const held = Math.max(Math.max(0, hold) / rate, sustain === 0 ? attack + decay : 0);
        // A glide is a ratio: a sequence note glides by the same interval as the voice.
        const glide = v[7] > 0 && v[0] > 0 ? v[7] / v[0] : 1;
        const vibRate = Math.max(0, v[8]) * rate, vibDepth = v[9];
        const pw = Math.min(0.99, Math.max(0.01, v[10])), cutoff = Math.max(0, v[11]);
        const fmRatio = Math.max(0, v[12]), fmIndex = v[13];
        const total = Math.max(1, Math.min(ToneSynthesizer.MAX_SAMPLES, Math.round((held + release) * sr)));
        const out = new Float32Array(total);
        const lp = cutoff > 0 ? 1 - Math.exp(-2 * Math.PI * cutoff / sr) : 1;
        let phase = 0, mod = 0, seed = 22222, noise = 0, y = 0, releaseFrom = -1;
        const level = (t: number) => {
            if (t < attack) return t / attack;
            if (t < attack + decay) return 1 - (1 - sustain) * (t - attack) / decay;
            return sustain;
        };
        for (let i = 0; i < total; i++) {
            const t = i / sr;
            let env: number;
            if (t < held) env = level(t);
            else {
                if (releaseFrom < 0) releaseFrom = level(held);
                env = release > 0 ? releaseFrom * Math.max(0, 1 - (t - held) / release) : 0;
            }
            let f = glide !== 1 && held > 0 ? f0 * Math.pow(glide, Math.min(t, held) / held) : f0;
            if (vibRate > 0 && vibDepth !== 0) f *= Math.pow(2, vibDepth / 12 * Math.sin(2 * Math.PI * vibRate * t));
            const before = phase;
            phase += f / sr;
            let q = phase - Math.floor(phase);
            if (fmRatio > 0 && fmIndex !== 0) {
                mod += f * fmRatio / sr;
                q += fmIndex * env * Math.sin(2 * Math.PI * (mod - Math.floor(mod))) / (2 * Math.PI);
                q -= Math.floor(q);
            }
            let x: number;
            switch (wave) {
                case 1: x = q < pw ? 1 : -1; break;                    // square / pulse
                case 2: x = 2 * q - 1; break;                          // sawtooth
                case 3: x = 1 - 4 * Math.abs(q - 0.5); break;          // triangle
                case 4:                                                // noise
                    if (i === 0 || f >= sr || Math.floor(phase) !== Math.floor(before)) {
                        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
                        noise = (seed >>> 8) / 8388608 - 1;
                    }
                    x = noise; break;
                default: x = Math.sin(2 * Math.PI * q); break;         // sine
            }
            y += lp * (x * env - y);
            out[i] = y;
        }
        return out;
    }

    /** The voice's echo applied to `dry`: repeats every delay, each `feedback` quieter. */
    private static echo(dry: Float32Array, v: number[], rate: number): Float32Array {
        const delay = Math.max(0, v[14]) / rate, feedback = Math.min(0.95, Math.max(0, v[15]));
        const sr = ToneSynthesizer.SAMPLE_RATE, d = Math.round(delay * sr);
        if (d < 1 || feedback <= 0) return dry;
        // The tail until a repeat is under 1%.
        const repeats = Math.ceil(Math.log(0.01) / Math.log(feedback));
        const out = new Float32Array(Math.min(ToneSynthesizer.MAX_SAMPLES, dry.length + d * repeats));
        for (let i = 0; i < out.length; i++) out[i] = (i < dry.length ? dry[i] : 0) + (i >= d ? out[i - d] * feedback : 0);
        return out;
    }

    /** -1..1 samples as a 16-bit WAV, one gain per channel: stereo when they differ. */
    private static toWav(samples: Float32Array, leftGain: number, rightGain: number): Uint8Array {
        const gl = Number.isFinite(leftGain) ? leftGain : 1, gr = Number.isFinite(rightGain) ? rightGain : 1;
        const channels = gl === gr ? 1 : 2;
        // Overlapping notes and echoes can add up past full scale: scale the whole sound
        // down rather than clip it.
        let peak = 0;
        for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
        if (peak > 1) for (let i = 0; i < samples.length; i++) samples[i] /= peak;
        const pcm = new Uint8Array(samples.length * 2 * channels);
        const put = (i: number, x: number) => {
            const s = Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
            pcm[i] = s & 0xff; pcm[i + 1] = (s >> 8) & 0xff;
        };
        for (let i = 0; i < samples.length; i++) {
            if (channels === 1) put(2 * i, samples[i] * gl);
            else { put(4 * i, samples[i] * gl); put(4 * i + 2, samples[i] * gr); }
        }
        return ToneSynthesizer.buildWav(pcm, ToneSynthesizer.SAMPLE_RATE, 16, channels);
    }

    /** Synthesize a complete WAV file for the given tone. */
    static synthesizeWav(frequency: number, durationSec: number, waveform: number): Uint8Array {
        return ToneSynthesizer.buildWav(
            ToneSynthesizer.synthesizePcm(
                frequency,
                durationSec,
                waveform,
                ToneSynthesizer.SAMPLE_RATE
            )
        );
    }
}

/** A finite number, or the default. */
function num(x: number, d: number): number { return Number.isFinite(x) ? x : d; }
