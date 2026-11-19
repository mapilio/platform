import dynamic from "next/dynamic";
import {CustomMeta} from "helper";
import {seoConfig} from "Configs/seoConfig";

// The map is a browser-only WebGL app; the classic map stays at /app/classic.
const Atlas = dynamic(() => import("views/platformApp/Atlas/Atlas"), { ssr: false });

export default function app() {
  return (
    <>
      <CustomMeta title={seoConfig.app.title} description={seoConfig.app.description} image={seoConfig.app.image}/>
      <Atlas />
    </>
  );
}
