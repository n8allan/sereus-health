/**
 * @format
 */

// Must be the first import: sets process.env.DEBUG before 'debug' initializes.
import './src/debug-bootstrap';

// Polyfills must run before any library code.
import './polyfills/hermes';
import './polyfills/intl-pluralrules';
import './polyfills/event';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
