/** Mono Ogg/Opus identification packet; reject WebM, Vorbis and stereo. */
export function validVoiceOgg(bytes: Uint8Array) {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  if (
    bytes.length < 47 ||
    ascii(0, 4) !== 'OggS' ||
    bytes[4] !== 0 ||
    (bytes[5] & 2) === 0 ||
    bytes[26] !== 1 ||
    bytes[27] !== 19
  )
    return false;
  return (
    ascii(28, 8) === 'OpusHead' &&
    bytes[36] === 1 &&
    bytes[37] === 1 &&
    bytes[46] === 0
  );
}
