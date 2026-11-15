import { registerRootComponent } from 'expo';
// Registers the background GPS task before anything else runs.
import './src/domains/workouts/recorder.ts';
import App from './App';

registerRootComponent(App);
