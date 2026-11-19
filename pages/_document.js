import Document, { Html, Head, Main, NextScript } from 'next/document';

const FONTS = 'https://fonts.googleapis.com/css2?family=Martian+Mono:wdth,wght@75..112.5,300..700&family=Mona+Sans:ital,wdth,wght@0,75..125,300..900;1,75..125,300..900&display=swap';

export default class AppDocument extends Document {
  render() {
    return (
      <Html lang="en">
        <Head>
          <link rel="icon" type="image/png" href="/mapilio_fav.png" />
          <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
          <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#0056f1" />
          <link rel="manifest" href="/site.webmanifest" />
          <meta name="theme-color" content="#0056f1" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link rel="stylesheet" href={FONTS} />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
