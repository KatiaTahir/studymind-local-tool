// splits on whitespace and drops empty pieces so double spaces or tabs don't
// count as extra words
function countWords(str) {
  const words = str.split(/\s+/).filter(Boolean);
  return words.length;
}

// splits text into chunks of roughly `targetWords` words, breaking on paragraph or
// sentence boundaries instead of mid sentence, since retrieval quality drops if a
// chunk cuts off in the middle of an idea
function chunkText(text, targetWords = 400) {
  const noWindowsLineEndings = text.replace(/\r\n/g, '\n');
  const cleaned = noWindowsLineEndings.trim();
  if (!cleaned) return [];

  // split on blank lines to get paragraphs, trim each one, drop anything empty
  const rawParas = cleaned.split(/\n\s*\n/);
  const paras = [];
  for (const p of rawParas) {
    const trimmed = p.trim();
    if (trimmed) paras.push(trimmed);
  }

  const chunks = [];
  let buf = [];
  let bufWords = 0;

  function flush() {
    if (buf.length > 0) {
      chunks.push(buf.join(' ').trim());
      buf = [];
      bufWords = 0;
    }
  }

  for (const para of paras) {
    const paraWordCount = countWords(para);

    // a paragraph way over target gets split internally, otherwise it becomes
    // one huge chunk that retrieval can't match well
    if (paraWordCount > targetWords * 1.5) {
      const sentences = para.match(/[^.!?]+[.!?]+|\S+$/g) || [para];
      for (const sentence of sentences) {
        const sentWordCount = countWords(sentence);
        const overflowing = bufWords + sentWordCount > targetWords;
        if (overflowing && buf.length > 0) flush();
        buf.push(sentence.trim());
        bufWords += sentWordCount;
      }
      continue;
    }

    const overflowing = bufWords + paraWordCount > targetWords;
    if (overflowing && buf.length > 0) flush();
    buf.push(para);
    bufWords += paraWordCount;
  }
  flush();

  return chunks;
}

module.exports = { chunkText };
