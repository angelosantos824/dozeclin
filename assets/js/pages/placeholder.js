import { protectPage } from '../auth/guards.js';
import { mountLayout } from '../ui/layout.js';

const profile = await protectPage();

if (profile) {
  mountLayout(profile);
}
