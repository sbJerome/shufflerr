// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { themeInitScript } from '@app/hooks/useTheme';
import type { DocumentContext, DocumentInitialProps } from 'next/document';
import Document, { Head, Html, Main, NextScript } from 'next/document';

import type { JSX } from 'react';

class MyDocument extends Document {
  static async getInitialProps(
    ctx: DocumentContext
  ): Promise<DocumentInitialProps> {
    const initialProps = await Document.getInitialProps(ctx);

    return initialProps;
  }

  render(): JSX.Element {
    return (
      // Dark is the default; the inline script swaps to the saved theme
      // before first paint so there is no flash.
      <Html lang="en" data-theme="dark" suppressHydrationWarning>
        <Head />
        <body>
          <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
