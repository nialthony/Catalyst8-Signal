import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="utf-8" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📊</text></svg>" />
        <meta name="description" content="AI-powered crypto spot trading signal generator with technical analysis" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
