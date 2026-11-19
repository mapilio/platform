import React from "react";
import CustomMeta from "helper/CustomMeta";
import {seoConfig} from "Configs/seoConfig";
import LandingPage from "views/landing/LandingPage";

const App = () => {
    return (
        <>
            <CustomMeta title={seoConfig.home.title} description={seoConfig.home.description} image={seoConfig.home.image}/>
            <LandingPage />
        </>
    );
};

export default App;
