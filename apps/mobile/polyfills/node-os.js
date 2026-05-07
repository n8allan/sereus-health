import { Platform } from 'react-native';

export function networkInterfaces() {
  return {};
}

export function platform() {
  return Platform.OS;
}

export function type() {
  return Platform.OS === 'ios' ? 'Darwin' : 'Linux';
}

export function hostname() {
  return 'localhost';
}

export default {
  networkInterfaces,
  platform,
  type,
  hostname,
};
