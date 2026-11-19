import {useRouter} from "next/router";
import Head from "next/head";
import { canonicalUrl, isPrivatePage, socialImageUrl, websiteSchema } from './seoMetadata.mjs';

const CustomMeta = ({
                        title = 'Mapilio |  Make better smart maps.',
                        description = 'Mapilio is the street-level imagery platform that scales and automates mapping using collaboration, cameras, and computer vision.',
                        image = 'https://mapilio.com/assets/mapilio-thumb.png',
                        noindex = false
                    }) => {
    const location = useRouter();
    const canonical = canonicalUrl(location.asPath);
    const socialImage = socialImageUrl(image);
    const privatePage = noindex || isPrivatePage(location.asPath);
    return (
        <Head>
            <title key={'title'} >{title}</title>
            <meta key={'meta-title'} name="title" content={title}/>
            <meta key={'meta-description'} name="description" content={description}/>
            <meta key={'meta-type'} property="og:type" content={'website'}/>
            <link key="canonical" rel="canonical" href={canonical}/>
            <meta key="og-site-name" property="og:site_name" content="Mapilio"/>
            <meta key="og-locale" property="og:locale" content="en_US"/>
            <meta key={'meta-og_url'} property="og:url" content={canonical}/>
            <meta key={'meta-og_title'} property="og:title" content={title}/>
            <meta key={'meta-og_description'} property="og:description" content={description}/>
            <meta key={'meta-og_image'} property="og:image" content={socialImage}/>
            <meta key={'meta-og_image_alt'} property="og:image:alt" content={title}/>
            <meta key={'meta-twitter_card'} name="twitter:card" content="summary_large_image"/>
            <meta key={'meta-twitter_url'} name="twitter:url" content={canonical}/>
            <meta key={'meta-twitter_title'} name="twitter:title" content={title}/>
            <meta key={'meta-twitter_description'} name="twitter:description"
                  content={description}
            />
            <meta key={'meta-twitter_image'} name="twitter:image"
                  content={socialImage}
            />

            {
              <meta key="robots" name="robots" content={privatePage
                ? 'noindex,follow'
                : 'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1'} />
            }
            <meta key="twitter-image-alt" name="twitter:image:alt" content={title}/>
            {
              !privatePage && canonical === 'https://mapilio.com/' && (
                <script key="website-schema" type="application/ld+json"
                  dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema).replace(/</g, '\\u003c') }}/>
              )
            }

        </Head>
    );
}

export default CustomMeta;
