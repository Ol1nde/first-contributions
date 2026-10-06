// node:sqlite emite un aviso «ExperimentalWarning» al cargarse. En el ejecutable autónomo no se pueden
// pasar opciones a Node, así que se filtra aquí. Debe importarse antes que cualquier otro módulo.
const emitWarning = process.emitWarning;

process.emitWarning = function filteredEmitWarning(warning, ...args) {
  const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
  if (type === 'ExperimentalWarning' && /SQLite/i.test(String(warning?.message ?? warning))) return;
  return emitWarning.call(process, warning, ...args);
};
