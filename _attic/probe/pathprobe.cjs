console.log('CHILD_PATH_HEAD=' + String(process.env.PATH).slice(0, 300));
console.log('HAS_CARGO=' + String(process.env.PATH).toLowerCase().includes('.cargo\\bin'));
console.log('HAS_MINGW=' + String(process.env.PATH).toLowerCase().includes('mingw64\\bin'));
