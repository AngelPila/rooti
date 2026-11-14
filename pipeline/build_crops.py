import json, sys

OUT = "/home/angelpilataxi/fieldshift/app/data/crops.json"

F56_CH6 = "https://www.fao.org/4/x0490e/x0490e0b.htm"
F56_CH8 = "https://www.fao.org/4/x0490e/x0490e0e.htm"
T11 = f"FAO Irrigation & Drainage Paper 56 (Crop evapotranspiration), Table 11 lengths of crop development stages — {F56_CH6}"
T12 = f"FAO Irrigation & Drainage Paper 56, Table 12 single crop coefficients (Kc ini from crop-group header row) — {F56_CH6}"
T22 = f"FAO Irrigation & Drainage Paper 56, Table 22 max effective rooting depth Zr and depletion fraction p — {F56_CH8}"
T24 = f"FAO Irrigation & Drainage Paper 56, Table 24 seasonal yield response factor Ky (from FAO I&D Paper 33) — {F56_CH8}"
IWM14 = "FAO Irrigation Water Management Training Manual No. 3 'Irrigation Water Needs', Ch. 3 Table 14 'Indicative values of crop water needs and sensitivity to drought' — https://www.fao.org/4/s2022e/s2022e07.htm"
IWM4 = "FAO Irrigation Water Management Training Manual No. 3 'Irrigation Water Needs', Ch. 2 Table 4 'Indicative values of the total growing period' — https://www.fao.org/4/s2022e/s2022e02.htm"
ECO_URL = "https://gaez.fao.org/pages/ecocrop (full DB mirror: https://github.com/OpenCLIM/ecocrop/blob/main/EcoCrop_DB.csv)"
def ECO(name, code, fields):
    return f"FAO ECOCROP database, {name} (EcoPort code {code}), fields {fields} — {ECO_URL}"
SB70 = "FAO Soils Bulletin 70 'Land husbandry - Components and strategy', Table 29 annual average USLE C factor for crops in West Africa — https://www.fao.org/4/t1765e/t1765e0j.htm"
BNF = "'Biological nitrogen fixation and prospects for ecological intensification in cereal-based cropping systems', Field Crops Research (2022), Table 9: regional mean shoot N fixed (kg N/ha/crop), compiled from 5374 field estimates — https://doi.org/10.1016/j.fcr.2022.108541 (full text: https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9133800/fullTextXML)"
GIEWS = "FAO GIEWS Country Brief Ecuador (reference date 2 Sep 2026) incl. crop calendar (main/minor season maize and paddy) — https://www.fao.org/giews/countrybrief/country.jsp?code=ECU"
SOYA = "'El cultivo de la soya en el Ecuador', technical talk, Agripac seed division, Guayaquil, Aug 2014 (cites INIAP trials) — https://agripac.com.ec/wp-content/uploads/2023/12/CHARLA-CULTIVO-DE-SOYA-2014_FR.pdf"
H603 = "'Development of a new maize hybrid for the Ecuadorian lowland' (INIAP H-603 Superior), Agronomía Colombiana 36(2):174-179, 2018 — https://www.redalyc.org/journal/1803/180358913010/180358913010.pdf"
RICE_EC = "Diario Expreso, 'La nueva semilla del INIAP: doble Impacto al arroz ecuatoriano' (quotes INIAP data for variety INIAP Impacto; Daule ratoon/soca practice) — https://www.expreso.ec/actualidad/economia/nueva-semillas-iniap-doble-impacto-arroz-ecuatoriano-87110.html"
CAUPI = "'Necesidades hídricas del caupí (Vigna unguiculata) var. INIAP-463 ... con lisímetro de drenaje', Chone, Manabí (36 m a.s.l.), Jan-Apr 2018, Ciencia y Agricultura 17(3), 2020 — https://doi.org/10.19053/01228420.v17.n3.2020.11746 (PDF: https://dialnet.unirioja.es/descarga/articulo/7595673.pdf)"
BEAN_Q = "'Cuantificación de enfermedades en líneas promisorias y variedades de fréjol en Quevedo, Ecuador', Biotecnología en el Sector Agropecuario y Agroindustrial 11(1), 2013 (AGRIS record) — https://agris.fao.org/search/en/records/67597e8ec7a957febdf90475"
UC_BEAN_RR = "UC IPM Dry Beans Pest Management Guidelines: Root rots — https://ipm.ucanr.edu/agriculture/dry-beans/root-rots/"
UC_BEAN_ROT = "UC IPM Dry Beans: Crop rotation — https://ipm.ucanr.edu/agriculture/dry-beans/crop-rotation/"
MANI_Q = "UTEQ thesis: agronomic traits and health of peanut germplasm (INIAP-380, INIAP-381 and lines), La María farm, Quevedo, dry season Sep-Dec 2010 (RRAAE record) — https://rraae.cedia.edu.ec/vufind/Record/UTEQ_04fc90a9f63f8f70fe0ac55dfee31efc/Description"
MANI_M = "UTEQ thesis 'Respuesta agronómica de dos variedades de maní (INIAP 381, INIAP 382) a tres marcos de plantación en la zona de Mocache' (Los Ríos) — https://repositorio.uteq.edu.ec/handle/43000/6487"
MANI_ACTA = "Acta Agronómica (2014): peanut germplasm in Quevedo, cercosporiosis and rust evaluation, 2010-2011 — https://www.redalyc.org/pdf/1699/169932435003.pdf"
PEANUT_ROT = "Farm Progress, 'Rotation takes spot No. 2 in top 10 keys to peanut profitability' (extension specialists: corn/sorghum rotations reduce Rhizoctonia, white mold, leaf spot) — https://www.farmprogress.com/management/rotation-takes-spot-no-2-in-top-10-keys-to-peanut-profitability"
SORGO_EC = "Agronomía y Ecosistemas (Univ. de Cienfuegos) article evaluating grain sorghum hybrids (MALÓN, ADVANTA 1302/1350/1250) in Montalvo, Ventanas and Quevedo, Los Ríos, dry season (May-Nov), for rice/maize rotations; full text not retrieved, abstract only — https://aes.ucf.edu.cu/index.php/aes/article/download/505/482/958"
TAR = "Terra Latinoamericana (2022) article on tar spot (Phyllachora maydis) in Ecuadorian maize; states crop rotation appears to reduce severity (abstract/snippet only) — https://mail.terralatinoamericana.org.mx/index.php/terra/article/download/1066/1769/15183"
PROSEA_CAN = "PROSEA (Plant Resources of South-East Asia), Canavalia ensiformis, via Pl@ntUse — https://uses.plantnet-project.org/en/Canavalia_ensiformis_(PROSEA)"
ARS_MUC = "USDA-ARS National Soil Dynamics Lab, Conservation Systems Fact Sheet No. 04t 'Velvet Bean' (Jan 2016) — https://www.ars.usda.gov/ARSUserFiles/60100500/FactSheets/FS04t.pdf"
IITA_COVER = "IITA repository record: cover-crop study, northern Cameroon (Mucuna reached ~100% ground cover 60-90 DAP; Canavalia rarely reached 100%); abstract via search only — https://biblio1.iita.org/handle/20.500.12478/4031"
IITA_MUCN = "IITA repository record: Mucuna N2 fixation on 15 farmers' fields, derived savanna of Benin (approx. 60 kg N/ha fixed at 20 weeks after planting, ~55% of plant N); abstract via search only — https://biblio1.iita.org/handle/20.500.12478/5329"
GM_BR = "'Abonos verdes y su influencia en el frijol en sistema agroecológico', Centro Agrícola 43(2):42-48, 2016 (UTEQ-Embrapa; trial at Santo Antônio de Goiás, Brazil; shoot N accumulated at 60 DAS, Table 4) — https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1058677/1/CNPAF2016ca.pdf"
QUEV_LEG = "Record: 'Agronomic response, chemical and microbiological composition of six leguminous plants in Quevedo canton, Ecuador' (incl. Mucuna, Canavalia; La María farm); abstract via search only — https://bdu.siu.edu.ar/bdu/Record/I10-R308-article-34046/Description"

crops = {}

crops["rice"] = dict(
    name_en="Rice (paddy / rainfed lowland)", name_es="Arroz", scientific="Oryza sativa",
    cycle_days=[121, 136],
    water_need_mm=[450, 700],
    kc={"ini": 1.05, "mid": 1.20, "end": [0.60, 0.90]},
    stages_days={"ini": 30, "dev": 30, "mid": 60, "late": 30, "total": 150, "ref": "Tropics, Dec/May planting"},
    temp_opt_c=[20, 30], temp_abs_c=[10, 36], temp_stress_c=36,
    drought_tolerance="low", flood_tolerance="high",
    n_fixing=False, n_fixed_kg_ha=None,
    root_depth_m=[0.5, 1.0], p_depletion=0.20, ky=None,
    ph=[5.5, 7.0], ph_abs=[4.5, 9.0],
    soil_cover="high", usle_c=[0.1, 0.2],
    grown_on_coast="Yes - major crop of Guayas and Los Ríos (Daule, Babahoyo). Main season sown Dec-Feb (rainy), minor season sown Jun-Aug (mostly irrigated). Ratoon (soca) widely used in Daule.",
    season=["invierno", "verano"],
    breaks_pest_cycle="Rotating rice with an upland crop (soybean) is used in Los Ríos specifically to break pest, disease and weed cycles and exploit residual moisture.",
    sources={
        "cycle_days": RICE_EC + " (INIAP Impacto: 121-136 d depending on season and system)",
        "water_need_mm": IWM14 + " (Rice (paddy) 450-700 mm; crop ET only, excludes puddling, percolation and standing-water losses)",
        "kc": T12 + " (Rice 1.05 / 1.20 / 0.90-0.60)",
        "stages_days": T11,
        "temp_opt_c": ECO("Oryza sativa", 1574, "TOPMN/TOPMX"),
        "temp_abs_c": ECO("Oryza sativa", 1574, "TMIN/TMAX"),
        "temp_stress_c": ECO("Oryza sativa", 1574, "TMAX (absolute max)"),
        "drought_tolerance": IWM14 + " (sensitivity to drought: high -> tolerance low)",
        "flood_tolerance": ECO("Oryza sativa", 1574, "DRA optimal drainage = poorly (saturated >50% of year)"),
        "n_fixing": "Not a legume; no symbiotic N fixation — " + BNF,
        "root_depth_m": T22, "p_depletion": T22,
        "ph": ECO("Oryza sativa", 1574, "PHOPMN/PHOPMX"), "ph_abs": ECO("Oryza sativa", 1574, "PHMIN/PHMAX"),
        "soil_cover": SB70 + " ('Intensively cropped upland rice' C = 0.1-0.2)", "usle_c": SB70,
        "grown_on_coast": GIEWS + " ; " + RICE_EC,
        "season": GIEWS,
        "breaks_pest_cycle": SOYA,
    })

crops["maize"] = dict(
    name_en="Hard yellow maize (grain)", name_es="Maíz duro amarillo", scientific="Zea mays",
    cycle_days=[118, 135],
    water_need_mm=[500, 800],
    kc={"ini": 0.3, "mid": 1.20, "end": [0.35, 0.60]},
    stages_days={"ini": 20, "dev": 35, "mid": 40, "late": 30, "total": 125, "ref": "Nigeria (humid), June planting"},
    temp_opt_c=[18, 33], temp_abs_c=[10, 47], temp_stress_c=47,
    drought_tolerance="low", flood_tolerance="low",
    n_fixing=False, n_fixed_kg_ha=None,
    root_depth_m=[1.0, 1.7], p_depletion=0.55, ky=1.25,
    ph=[5.0, 7.0], ph_abs=[4.5, 8.5],
    soil_cover="low", usle_c=[0.4, 0.9],
    grown_on_coast="Yes - Los Ríos, Guayas and Manabí are the key producing provinces. Mostly sown Dec-Jan at start of rainy season; dry-season crop sown Jun-Jul with irrigation or residual moisture.",
    season=["invierno", "verano"],
    breaks_pest_cycle="Tar spot (mancha de asfalto, Phyllachora maydis) is a key foliar disease in Ecuadorian maize; crop rotation appears to reduce its severity.",
    sources={
        "cycle_days": H603 + " (Table 1: harvest 120 d, range 118-135 d)",
        "water_need_mm": IWM14 + " (Maize 500-800 mm)",
        "kc": T12 + " (Maize field grain: cereals group Kc ini 0.3; 1.20; 0.60-0.35)",
        "stages_days": T11,
        "temp_opt_c": ECO("Zea mays", 2175, "TOPMN/TOPMX"),
        "temp_abs_c": ECO("Zea mays", 2175, "TMIN/TMAX"),
        "temp_stress_c": ECO("Zea mays", 2175, "TMAX (absolute max)"),
        "drought_tolerance": IWM14 + " (sensitivity medium-high) ; " + T24 + " (Ky 1.25, most sensitive of the crops here)",
        "flood_tolerance": ECO("Zea mays ssp. mays", 238663, "DRA/DRAR = well (dry spells) / excessive; poorly drained not tolerated"),
        "n_fixing": "Not a legume — " + BNF,
        "root_depth_m": T22, "p_depletion": T22, "ky": T24,
        "ph": ECO("Zea mays", 2175, "PHOPMN/PHOPMX"), "ph_abs": ECO("Zea mays", 2175, "PHMIN/PHMAX"),
        "soil_cover": SB70 + " ('Maize, millet, sorghum' C = 0.4-0.9)", "usle_c": SB70,
        "grown_on_coast": GIEWS + " ; " + H603,
        "season": GIEWS + " ; " + H603,
        "breaks_pest_cycle": TAR,
    })

crops["soybean"] = dict(
    name_en="Soybean", name_es="Soya", scientific="Glycine max",
    cycle_days=[105, 120],
    water_need_mm=[450, 700],
    kc={"ini": 0.4, "mid": 1.15, "end": 0.50},
    stages_days={"ini": 15, "dev": 15, "mid": 40, "late": 15, "total": 85, "ref": "Tropics, Dec planting"},
    temp_opt_c=[20, 33], temp_abs_c=[10, 38], temp_stress_c=38,
    drought_tolerance="medium", flood_tolerance="medium",
    n_fixing=True, n_fixed_kg_ha=[76, 177],
    root_depth_m=[0.6, 1.3], p_depletion=0.50, ky=0.85,
    ph=[5.5, 6.5], ph_abs=[4.5, 8.4],
    soil_cover=None, usle_c=None,
    grown_on_coast="Yes - Los Ríos produces ~97% of national soybean (Quevedo, Valencia, Buena Fe; Babahoyo, Montalvo, Pueblo Viejo, Ventanas). Grown in the dry season on residual moisture after rice or maize; rainy-season sowing has disease and lodging problems. Babahoyo needs supplementary irrigation.",
    season=["verano"],
    breaks_pest_cycle="Grown in rotation specifically to break pest, disease and weed cycles; rotation is a listed preventive measure against whitefly (Bemisia spp.).",
    sources={
        "cycle_days": SOYA + " (SOYICA P34 105-110 d; INIAP 307 112-115 d; Panorama 29 115-120 d)",
        "water_need_mm": IWM14 + " (Soybean 450-700 mm). Note: the Agripac talk gives an optimum of 300 mm/cycle for Ecuador",
        "kc": T12 + " (Soybeans: legumes group Kc ini 0.4; 1.15; 0.50)",
        "stages_days": T11,
        "temp_opt_c": ECO("Glycine max", 1150, "TOPMN/TOPMX"),
        "temp_abs_c": ECO("Glycine max", 1150, "TMIN/TMAX"),
        "temp_stress_c": ECO("Glycine max", 1150, "TMAX (absolute max)"),
        "drought_tolerance": IWM14 + " (sensitivity low-medium) ; " + T24 + " (Ky 0.85)",
        "flood_tolerance": ECO("Glycine max", 1150, "DRAR absolute drainage includes poorly (saturated >50% of year); optimum well-drained"),
        "n_fixing": BNF,
        "n_fixed_kg_ha": BNF + " (range of regional means 76-177; South America 177)",
        "root_depth_m": T22, "p_depletion": T22, "ky": T24,
        "ph": ECO("Glycine max", 1150, "PHOPMN/PHOPMX"), "ph_abs": ECO("Glycine max", 1150, "PHMIN/PHMAX"),
        "grown_on_coast": SOYA, "season": SOYA, "breaks_pest_cycle": SOYA,
    })

crops["peanut"] = dict(
    name_en="Peanut (groundnut)", name_es="Maní", scientific="Arachis hypogaea",
    cycle_days=[90, 150],
    water_need_mm=[500, 700],
    kc={"ini": 0.4, "mid": 1.15, "end": 0.60},
    stages_days={"ini": 25, "dev": 35, "mid": 45, "late": 25, "total": 130, "ref": "West Africa, dry season"},
    temp_opt_c=[22, 32], temp_abs_c=[10, 45], temp_stress_c=45,
    drought_tolerance="medium", flood_tolerance="low",
    n_fixing=True, n_fixed_kg_ha=[62, 121],
    root_depth_m=[0.5, 1.0], p_depletion=0.50, ky=0.70,
    ph=[5.5, 6.5], ph_abs=[4.5, 8.5],
    soil_cover="low", usle_c=[0.4, 0.8],
    grown_on_coast="Yes, minor crop - INIAP varieties (INIAP-380, 381, 382) evaluated in Quevedo and Mocache (Los Ríos); dry-season trial Sep-Dec in Quevedo.",
    season=["verano"],
    breaks_pest_cycle="Cercospora leaf spot and rust occur on peanut in Quevedo; rotating with grasses (maize, sorghum) reduces leaf spot, white mold and Rhizoctonia pressure.",
    sources={
        "cycle_days": ECO("Arachis hypogaea", 2199, "GMIN/GMAX crop cycle") + " ; FAO IWM Table 4 gives 130-140 d — " + IWM4,
        "water_need_mm": IWM14 + " (Peanut 500-700 mm)",
        "kc": T12 + " (Groundnut: legumes group Kc ini 0.4; 1.15; 0.60)",
        "stages_days": T11,
        "temp_opt_c": ECO("Arachis hypogaea", 2199, "TOPMN/TOPMX"),
        "temp_abs_c": ECO("Arachis hypogaea", 2199, "TMIN/TMAX"),
        "temp_stress_c": ECO("Arachis hypogaea", 2199, "TMAX (absolute max)"),
        "drought_tolerance": IWM14 + " (sensitivity low-medium) ; " + T24 + " (Ky 0.70)",
        "flood_tolerance": ECO("Arachis hypogaea", 2199, "DRA/DRAR = well (dry spells) only"),
        "n_fixing": BNF,
        "n_fixed_kg_ha": BNF + " (range of regional means 62-121; Americas 103)",
        "root_depth_m": T22, "p_depletion": T22, "ky": T24,
        "ph": ECO("Arachis hypogaea", 2199, "PHOPMN/PHOPMX"), "ph_abs": ECO("Arachis hypogaea", 2199, "PHMIN/PHMAX"),
        "soil_cover": SB70 + " (Groundnut C = 0.4-0.8)", "usle_c": SB70,
        "grown_on_coast": MANI_Q + " ; " + MANI_M,
        "season": MANI_Q,
        "breaks_pest_cycle": MANI_ACTA + " ; " + PEANUT_ROT,
    })

crops["common_bean"] = dict(
    name_en="Common bean (dry)", name_es="Fréjol", scientific="Phaseolus vulgaris",
    cycle_days=[95, 110],
    water_need_mm=[300, 500],
    kc={"ini": 0.4, "mid": 1.15, "end": 0.35},
    stages_days={"ini": 15, "dev": 25, "mid": 35, "late": 20, "total": 95, "ref": "Pakistan/California, June planting (no tropical row in Table 11)"},
    temp_opt_c=[16, 25], temp_abs_c=[7, 32], temp_stress_c=32,
    drought_tolerance="low", flood_tolerance="low",
    n_fixing=True, n_fixed_kg_ha=[29, 60],
    root_depth_m=[0.6, 0.9], p_depletion=0.45, ky=1.15,
    ph=[5.5, 7.5], ph_abs=[4.0, 9.0],
    soil_cover=None, usle_c=None,
    grown_on_coast="Marginal on the coast (mainly a highland crop). Evaluated in Quevedo (21 lines/varieties incl. INIAP-473) with high disease pressure. ECOCROP optimum (16-25 °C) is below typical lowland temperatures.",
    season=None,
    breaks_pest_cycle="Soil-borne Fusarium, Rhizoctonia solani (mustia hilachosa) and Macrophomina found on beans in Quevedo; rotating to cereals lowers Fusarium root-rot inoculum (sorghum and maize also host Macrophomina, so they don't break charcoal rot).",
    sources={
        "cycle_days": IWM4 + " (Bean dry 95-110 d)",
        "water_need_mm": IWM14 + " (Bean 300-500 mm)",
        "kc": T12 + " (Beans dry and pulses: 0.4; 1.15; 0.35)",
        "stages_days": T11,
        "temp_opt_c": ECO("Phaseolus vulgaris", 1668, "TOPMN/TOPMX"),
        "temp_abs_c": ECO("Phaseolus vulgaris", 1668, "TMIN/TMAX"),
        "temp_stress_c": ECO("Phaseolus vulgaris", 1668, "TMAX (absolute max)"),
        "drought_tolerance": IWM14 + " (sensitivity medium-high) ; " + T24 + " (Ky 1.15)",
        "flood_tolerance": ECO("Phaseolus vulgaris", 1668, "DRA/DRAR = well (dry spells) only"),
        "n_fixing": BNF,
        "n_fixed_kg_ha": BNF + " (range of regional means 29-60; South America 35)",
        "root_depth_m": T22, "p_depletion": T22, "ky": T24,
        "ph": ECO("Phaseolus vulgaris", 1668, "PHOPMN/PHOPMX"), "ph_abs": ECO("Phaseolus vulgaris", 1668, "PHMIN/PHMAX"),
        "grown_on_coast": BEAN_Q + " ; " + ECO("Phaseolus vulgaris", 1668, "TOPMN/TOPMX"),
        "breaks_pest_cycle": BEAN_Q + " ; " + UC_BEAN_RR + " ; " + UC_BEAN_ROT,
    })

crops["cowpea"] = dict(
    name_en="Cowpea", name_es="Caupí / fréjol caupí", scientific="Vigna unguiculata",
    cycle_days=[80, 110],
    water_need_mm=[254, 254],
    kc={"ini": 0.4, "mid": 1.05, "end": [0.35, 0.60]},
    kc_local={"stage_kc": [0.45, 0.88, 1.28, 0.70], "stage_days": [15, 20, 25, 20], "ref": "INIAP-463, Chone, rainy season 2018, drainage lysimeter"},
    stages_days={"ini": 20, "dev": 30, "mid": 30, "late": 20, "total": 110, "ref": "Green gram/cowpeas, Mediterranean, March planting"},
    temp_opt_c=[25, 35], temp_abs_c=[15, 40], temp_stress_c=40,
    drought_tolerance="high", flood_tolerance="low",
    n_fixing=True, n_fixed_kg_ha=[25, 47],
    root_depth_m=[0.6, 1.0], p_depletion=0.45, ky=None,
    ph=[5.5, 7.5], ph_abs=[4.0, 8.8],
    soil_cover="medium", usle_c=[0.3, 0.3],
    grown_on_coast="Yes, minor - INIAP released variety INIAP-463; water-use study in Chone, Manabí (coastal lowland, 36 m). No Guayas/Los Ríos production data found.",
    season=["invierno"],
    breaks_pest_cycle=None,
    sources={
        "cycle_days": CAUPI + " (80 d after transplant) ; " + T11 + " (110 d total)",
        "water_need_mm": CAUPI + " (254 mm over 80 d; single study, rainy season)",
        "kc": T12 + " (Cowpeas: legumes group Kc ini 0.4; 1.05; 0.60-0.35)",
        "kc_local": CAUPI,
        "stages_days": T11,
        "temp_opt_c": ECO("Vigna unguiculata", 2153, "TOPMN/TOPMX"),
        "temp_abs_c": ECO("Vigna unguiculata", 2153, "TMIN/TMAX"),
        "temp_stress_c": ECO("Vigna unguiculata", 2153, "TMAX (absolute max)"),
        "drought_tolerance": ECO("Vigna unguiculata", 2153, "ABITOL abiotic tolerance = drought"),
        "flood_tolerance": ECO("Vigna unguiculata", 2153, "ABISUS abiotic susceptibility = fire, flooding"),
        "n_fixing": BNF,
        "n_fixed_kg_ha": BNF + " (range of regional means 25-47; Americas 39)",
        "root_depth_m": T22 + " ('Green gram and cowpeas' 0.6-1.0)", "p_depletion": T22,
        "ph": ECO("Vigna unguiculata", 2153, "PHOPMN/PHOPMX"), "ph_abs": ECO("Vigna unguiculata", 2153, "PHMIN/PHMAX"),
        "soil_cover": SB70 + " ('Creeping cowpea' C = 0.3)", "usle_c": SB70,
        "grown_on_coast": CAUPI, "season": CAUPI + " (trial Jan-Apr = rainy season)",
    })

crops["sorghum"] = dict(
    name_en="Grain sorghum", name_es="Sorgo granífero", scientific="Sorghum bicolor",
    cycle_days=[120, 130],
    water_need_mm=[450, 650],
    kc={"ini": 0.3, "mid": [1.00, 1.10], "end": 0.55},
    stages_days={"ini": 20, "dev": 35, "mid": 40, "late": 30, "total": 125, "ref": "USA/Pakistan/Mediterranean, May-June planting (no tropical row)"},
    temp_opt_c=[22, 35], temp_abs_c=[8, 40], temp_stress_c=40,
    drought_tolerance="high", flood_tolerance="low",
    n_fixing=False, n_fixed_kg_ha=None,
    root_depth_m=[1.0, 2.0], p_depletion=0.55, ky=0.90,
    ph=[5.5, 7.5], ph_abs=[5.0, 8.0],
    soil_cover="low", usle_c=[0.4, 0.9],
    grown_on_coast="Minor/experimental - hybrids evaluated in Montalvo, Ventanas and Quevedo (Los Ríos) in the dry season for rice/maize rotations; authors note few adapted genotypes in Ecuador.",
    season=["verano"],
    breaks_pest_cycle="As a grass it breaks legume disease cycles (peanut leaf spot, white mold, Rhizoctonia); caveat: it hosts Macrophomina charcoal rot and bean root-rot pathogens.",
    sources={
        "cycle_days": IWM4 + " (Sorghum 120-130 d)",
        "water_need_mm": IWM14 + " (Sorghum/Millet 450-650 mm)",
        "kc": T12 + " (Sorghum grain: cereals group Kc ini 0.3; 1.00-1.10; 0.55)",
        "stages_days": T11,
        "temp_opt_c": ECO("Sorghum bicolor", 48747, "TOPMN/TOPMX"),
        "temp_abs_c": ECO("Sorghum bicolor", 48747, "TMIN/TMAX"),
        "temp_stress_c": ECO("Sorghum bicolor", 48747, "TMAX (absolute max)"),
        "drought_tolerance": IWM14 + " (sensitivity low) ; " + T24 + " (Ky 0.9)",
        "flood_tolerance": ECO("Sorghum bicolor", 48747, "DRA/DRAR = well / excessive; poorly drained not listed"),
        "n_fixing": "Not a legume — " + BNF,
        "root_depth_m": T22, "p_depletion": T22, "ky": T24,
        "ph": ECO("Sorghum bicolor", 48747, "PHOPMN/PHOPMX"), "ph_abs": ECO("Sorghum bicolor", 48747, "PHMIN/PHMAX"),
        "soil_cover": SB70 + " ('Maize, millet, sorghum' C = 0.4-0.9)", "usle_c": SB70,
        "grown_on_coast": SORGO_EC, "season": SORGO_EC,
        "breaks_pest_cycle": PEANUT_ROT + " ; " + UC_BEAN_ROT,
    })

crops["jack_bean"] = dict(
    name_en="Jack bean (cover / green manure)", name_es="Canavalia / fréjol de puerco", scientific="Canavalia ensiformis",
    cycle_days=[50, 110],
    water_need_mm=None,
    kc=None, stages_days=None,
    temp_opt_c=[20, 28], temp_abs_c=[14, 36], temp_stress_c=36,
    drought_tolerance="medium", flood_tolerance="medium",
    n_fixing=True, n_fixed_kg_ha=None, n_shoot_accum_kg_ha=[173, 173],
    root_depth_m=None, p_depletion=None, ky=None,
    ph=[5.0, 6.0], ph_abs=[4.3, 8.0],
    soil_cover="medium", usle_c=None,
    grown_on_coast="Experimental only - evaluated with Mucuna in trials at the UTEQ La María farm, Quevedo. Not a commercial crop.",
    season=None,
    breaks_pest_cycle=None,
    sources={
        "cycle_days": PROSEA_CAN + " (flowers 50-110 d after sowing; green manure is cut at flowering; seed harvest ~170 d)",
        "temp_opt_c": ECO("Canavalia ensiformis", 609, "TOPMN/TOPMX"),
        "temp_abs_c": ECO("Canavalia ensiformis", 609, "TMIN/TMAX"),
        "temp_stress_c": ECO("Canavalia ensiformis", 609, "TMAX (absolute max)"),
        "drought_tolerance": PROSEA_CAN + " ('hardy and can withstand periods of drought')",
        "flood_tolerance": PROSEA_CAN + " ('less affected by waterlogging ... than other pulses') ; " + ECO("Canavalia ensiformis", 609, "DRAR includes poorly drained"),
        "n_fixing": PROSEA_CAN + " (legume grown as green manure)",
        "n_shoot_accum_kg_ha": GM_BR + " (173.4 kg N/ha in shoot biomass at 60 DAS; total N accumulated, NOT fixed N)",
        "ph": ECO("Canavalia ensiformis", 609, "PHOPMN/PHOPMX"), "ph_abs": ECO("Canavalia ensiformis", 609, "PHMIN/PHMAX"),
        "soil_cover": IITA_COVER,
        "grown_on_coast": QUEV_LEG,
    })

crops["velvet_bean"] = dict(
    name_en="Velvet bean (cover / green manure)", name_es="Mucuna / fréjol terciopelo", scientific="Mucuna pruriens",
    cycle_days=[90, 120],
    water_need_mm=None,
    kc=None, stages_days=None,
    temp_opt_c=[20, 30], temp_abs_c=[10, 34], temp_stress_c=34,
    drought_tolerance="high", flood_tolerance="low",
    n_fixing=True, n_fixed_kg_ha=[60, 60], n_shoot_accum_kg_ha=[224, 303],
    root_depth_m=None, p_depletion=None, ky=None,
    ph=[5.0, 7.0], ph_abs=[4.0, 8.0],
    soil_cover="high", usle_c=None,
    grown_on_coast="Experimental only - evaluated in trials at the UTEQ La María farm, Quevedo. Not a commercial crop.",
    season=None,
    breaks_pest_cycle="Suppresses root-knot and reniform nematodes and smothers weeds (rated excellent for nematode control).",
    sources={
        "cycle_days": ARS_MUC + " (cover crop terminated ~90 d at flowering; ~120 d to seed maturity)",
        "temp_opt_c": ECO("Mucuna pruriens", 7832, "TOPMN/TOPMX"),
        "temp_abs_c": ECO("Mucuna pruriens", 7832, "TMIN/TMAX"),
        "temp_stress_c": ECO("Mucuna pruriens", 7832, "TMAX (absolute max)"),
        "drought_tolerance": ECO("Mucuna pruriens", 7832, "ABITOL abiotic tolerance = drought"),
        "flood_tolerance": ECO("Mucuna pruriens", 7832, "ABISUS abiotic susceptibility = flooding"),
        "n_fixing": IITA_MUCN,
        "n_fixed_kg_ha": IITA_MUCN + " (single farmer-field estimate; low end, nodulation sometimes fails)",
        "n_shoot_accum_kg_ha": GM_BR + " (223.8 kg N/ha at 60 DAS) ; " + ARS_MUC + " (up to 270 lb N/acre = ~303 kg N/ha). Total N accumulated, NOT fixed N",
        "ph": ECO("Mucuna pruriens", 7832, "PHOPMN/PHOPMX"), "ph_abs": ECO("Mucuna pruriens", 7832, "PHMIN/PHMAX"),
        "soil_cover": ARS_MUC + " (erosion control 'Very Good'; vines cover the soil) ; " + IITA_COVER,
        "grown_on_coast": QUEV_LEG,
        "breaks_pest_cycle": ARS_MUC,
    })

local_rotations = [
    {"sequence": ["rice (invierno)", "soybean (verano)"],
     "region": "Lower Guayas basin, Los Ríos: Babahoyo, Montalvo, Pueblo Viejo, San Juan, Baba, Ventanas",
     "note": "Soy sown right after rice harvest on residual moisture; Babahoyo needs supplementary irrigation.",
     "source": SOYA},
    {"sequence": ["maize or rice (invierno)", "soybean (verano)"],
     "region": "Upper Guayas basin, Los Ríos: Quevedo, Valencia, Buena Fe",
     "source": SOYA},
    {"sequence": ["maize (invierno, sown Dec-Jan)", "maize (verano, sown Jun-Jul, irrigated or residual moisture)"],
     "region": "Ecuadorian coastal lowlands (Manabí, Guayas, Los Ríos)",
     "source": H603 + " ; " + GIEWS},
    {"sequence": ["rice main season (sown Dec-Feb)", "rice minor season (sown Jun-Aug, mostly irrigated) or ratoon (soca)"],
     "region": "Guayas and Los Ríos (e.g., Daule)",
     "source": GIEWS + " ; " + RICE_EC},
    {"sequence": ["Mucuna / Canavalia green manure (cut at 60 DAS)", "common bean (sown 20 d after cutting)"],
     "region": "EXPERIMENTAL, Santo Antônio de Goiás, Brazil (UTEQ co-authors) - not observed in Ecuador",
     "source": GM_BR},
]

meta = {
    "description": "Agronomic parameters for candidate crops in rotations for smallholders on the Ecuadorian coast (Guayas / Los Ríos: Babahoyo, Daule, Quevedo; 5-120 m a.s.l.). Every non-null value has an entry in that crop's 'sources' map (document name - URL).",
    "compiled": "2026-11-14",
    "notes": " ".join([
        "Units: cycle_days and stages_days in days; water_need_mm = seasonal crop water need (ETc) for the whole cycle, excluding conveyance and application losses and, for paddy rice, excluding puddling, percolation and standing-water losses; temps in °C; root_depth_m = FAO-56 maximum effective rooting depth Zr.",
        "kc: FAO-56 Table 12 (sub-humid climate, RHmin~45%, u2~2 m/s); Kc ini is the crop-group default (cereals 0.3, legumes 0.4) and must be adjusted for wetting frequency (FAO-56 Ch. 6). Where FAO gives a range, the value is [min,max]. stages_days: FAO-56 Table 11 row closest to humid tropics; scale to local cycle_days.",
        "temp_opt_c = ECOCROP optimal range (TOPMN-TOPMX). temp_stress_c = ECOCROP absolute maximum (TMAX), i.e. the upper limit for growth, NOT a flowering heat-sterility threshold; stress starts above temp_opt_c[1].",
        "drought_tolerance: inverse of FAO IWM Manual 3 Table 14 'sensitivity to drought' (high or medium-high -> low; low-medium -> medium; low -> high), cross-checked with FAO-56 Ky; for crops not in Table 14, ECOCROP 'abiotic tolerance' or PROSEA.",
        "flood_tolerance rule: high if ECOCROP optimal drainage is 'poorly drained'; medium if poorly drained soils are within the ECOCROP absolute range (or PROSEA says waterlogging-tolerant); low otherwise or if ECOCROP lists flooding as a susceptibility.",
        "n_fixed_kg_ha: shoot N fixed per crop (range across regional means), not net soil N balance; grain removal exports much of it. n_shoot_accum_kg_ha = total N in cover-crop biomass, not fixed N.",
        "soil_cover from FAO Soils Bulletin 70 West-Africa USLE C factors: C>=0.4 -> low, 0.2-0.4 -> medium, <0.2 -> high; cover crops rated from USDA-ARS and IITA ground-cover observations.",
        "ECOCROP data read from the full ECOCROP DB CSV mirrored in the OpenCLIM/ecocrop repo because the FAO ECOCROP web app needs a login; values are the same database.",
        "Sources marked 'abstract via search only' were not read in full text; verify before final publication.",
    ]),
    "null_fields": {
        "rice.ky / cowpea.ky": "FAO-56 Table 24 has no Ky for rice or cowpea.",
        "soybean.soil_cover, common_bean.soil_cover": "No soybean or common bean row in FAO SB70 Table 29; no other C-factor source found.",
        "common_bean.season": "Coastal bean trials exist in Quevedo, but no verified source gives the season.",
        "cowpea.breaks_pest_cycle, jack_bean.breaks_pest_cycle": "No source found.",
        "jack_bean / velvet_bean: water_need_mm, kc, stages_days, root_depth_m, p_depletion, ky, usle_c": "Not covered in FAO-56 / FAO IWM tables; ECOCROP gives only annual rainfall, which is not a seasonal crop water need.",
        "jack_bean.n_fixed_kg_ha": "Only total shoot N accumulation was found, not a measured fixed-N value.",
        "jack_bean.season, velvet_bean.season": "Only experimental trials in Quevedo; no farmer season documented.",
    },
}

data = {"_meta": meta, "crops": crops, "local_rotations": local_rotations}

# validation: every non-null field (except names/sources) has a source
skip = {"name_en", "name_es", "scientific", "sources"}
errors = []
for cid, c in crops.items():
    for k, v in c.items():
        if k in skip or v is None:
            continue
        if k not in c["sources"]:
            errors.append(f"{cid}.{k}")
    for k in c["sources"]:
        if c.get(k) is None:
            errors.append(f"{cid}: source for null/missing field {k}")
if errors:
    print("MISSING SOURCES:", errors); sys.exit(1)

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print("written", OUT)
