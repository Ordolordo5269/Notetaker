// AudioWorklet: converts the microphone stream to mono PCM16 at 24 kHz and
// reports the input level. Runs on the audio rendering thread.
//
// Messages posted to the main thread:
//   { type: "frame", pcm: ArrayBuffer (Int16, 2400 samples = 100 ms), rms: number, peak: number }
class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = (options && options.processorOptions && options.processorOptions.targetRate) || 24000;
    this.ratio = sampleRate / this.targetRate;
    this.frameSamples = Math.round(this.targetRate / 10); // 100 ms
    this.out = new Int16Array(this.frameSamples);
    this.outIndex = 0;
    this.phase = 0; // fractional read position for resampling
    this.carry = new Float32Array(0);
    this.sumSquares = 0;
    this.peak = 0;
    this.muted = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "mute") this.muted = Boolean(e.data.value);
    };
  }

  pushSample(v) {
    const s = v <= -1 ? -32768 : v >= 1 ? 32767 : (v * 32767) | 0;
    this.out[this.outIndex++] = s;
    const a = Math.abs(v);
    this.sumSquares += v * v;
    if (a > this.peak) this.peak = a;
    if (this.outIndex === this.frameSamples) {
      const buf = this.out.buffer.slice(0);
      this.port.postMessage(
        { type: "frame", pcm: buf, rms: Math.sqrt(this.sumSquares / this.frameSamples), peak: this.peak },
        [buf],
      );
      this.outIndex = 0;
      this.sumSquares = 0;
      this.peak = 0;
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    // Mix down to mono.
    const n = input[0].length;
    let mono = input[0];
    if (input.length > 1) {
      mono = new Float32Array(n);
      for (let c = 0; c < input.length; c++) {
        const ch = input[c];
        for (let i = 0; i < n; i++) mono[i] += ch[i] / input.length;
      }
    }
    if (this.muted) mono = new Float32Array(n);

    if (this.ratio === 1) {
      for (let i = 0; i < n; i++) this.pushSample(mono[i]);
      return true;
    }
    // Resample: box-average over the source span for each output sample
    // (acts as a crude anti-alias filter when downsampling).
    const src = new Float32Array(this.carry.length + n);
    src.set(this.carry, 0);
    src.set(mono, this.carry.length);
    let pos = this.phase;
    const span = this.ratio;
    while (pos + span <= src.length) {
      const start = Math.floor(pos);
      const end = Math.floor(pos + span);
      let acc = 0;
      let count = 0;
      for (let i = start; i < end; i++) {
        acc += src[i];
        count++;
      }
      this.pushSample(count ? acc / count : src[start]);
      pos += span;
    }
    const consumed = Math.floor(pos);
    this.carry = src.slice(consumed);
    this.phase = pos - consumed;
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
