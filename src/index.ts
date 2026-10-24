declare const ide:{register(plugin:unknown):void};
import {ComposerPlugin} from './shared/language/plugins/composer';ide.register(new ComposerPlugin());
