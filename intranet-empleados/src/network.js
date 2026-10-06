import { networkInterfaces } from 'node:os';

/** Direcciones IPv4 de la red local de este equipo (para acceder desde otros equipos). */
export function lanAddresses() {
  return Object.values(networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}
