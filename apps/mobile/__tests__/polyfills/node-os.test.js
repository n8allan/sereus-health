import { Platform } from 'react-native';
import os, { networkInterfaces, platform, type, hostname } from '../../polyfills/node-os';

describe('node-os polyfill', () => {
  test('networkInterfaces returns empty object', () => {
    expect(networkInterfaces()).toEqual({});
  });

  test('platform returns Platform.OS', () => {
    expect(platform()).toBe(Platform.OS);
  });

  test('type returns Darwin for ios', () => {
    const orig = Platform.OS;
    Platform.OS = 'ios';
    expect(type()).toBe('Darwin');
    Platform.OS = orig;
  });

  test('type returns Linux for android', () => {
    const orig = Platform.OS;
    Platform.OS = 'android';
    expect(type()).toBe('Linux');
    Platform.OS = orig;
  });

  test('hostname returns localhost', () => {
    expect(hostname()).toBe('localhost');
  });

  test('default export has all named exports', () => {
    expect(os.networkInterfaces).toBe(networkInterfaces);
    expect(os.platform).toBe(platform);
    expect(os.type).toBe(type);
    expect(os.hostname).toBe(hostname);
  });
});
