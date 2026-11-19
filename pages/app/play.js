import dynamic from "next/dynamic";
import {CustomMeta} from "helper";
import {seoConfig} from "Configs/seoConfig";

const Play = dynamic(() => import("views/platformApp/Play/Play"), { ssr: false });

export default function PlayPage() {
  return (
    <>
      <CustomMeta
        title="Mapilio | Where am I? Daily five"
        description="Five real street photos from Mapilio contributors. Guess where each was taken, keep your streak and collect badges."
        image={seoConfig.app.image}
      />
      <Play />
    </>
  );
}
