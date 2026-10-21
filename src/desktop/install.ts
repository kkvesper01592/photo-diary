// main.tsx の最初に読み込む: 専用アプリの中なら、ほかのモジュールが設定を読む前に保存場所を差し替える
import { installDesktopHost } from './host'

installDesktopHost()
