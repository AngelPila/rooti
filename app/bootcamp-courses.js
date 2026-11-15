// Course cards and lesson material for the bootcamp. Keep advice practical and
// locally verifiable; the lessons teach decisions, not universal prescriptions.
export const BOOTCAMP_COURSES = {
  es: [
    {
      id: "rotation", title: "Rotación de cultivos", duration: 12,
      description: "Aprenda a alternar cultivos y familias para organizar las siembras, reducir la repetición y mantener el suelo cubierto.",
      outcomes: ["Reconocer familias y funciones de los cultivos", "Armar una secuencia que respete agua, fechas y drenaje", "Registrar lo que ocurre para mejorar el siguiente ciclo"],
    },
    {
      id: "soil", title: "Suelo vivo y fertilidad", duration: 18,
      description: "Observe el suelo antes de intervenir: textura, estructura, cobertura y nutrientes ayudan a decidir cómo cuidarlo.",
      outcomes: ["Observar señales físicas del suelo", "Proteger la superficie y aprovechar los residuos", "Usar análisis y recomendaciones locales para fertilizar"],
      lessons: [
        {
          title: "Mire el suelo más allá del color",
          paragraphs: [
            "El suelo sostiene las raíces, almacena agua y aire, y alberga organismos que transforman residuos. Su color da pistas, pero no basta para saber si está sano. Observe cómo se desmorona, si forma costra después de la lluvia, si se encharca y si las raíces pueden penetrar.",
            "La textura describe la proporción de arena, limo y arcilla. Un puñado húmedo puede dar una idea aproximada: la arena se siente áspera, la arcilla es más pegajosa y el limo se siente suave. Esta prueba no reemplaza un análisis, pero ayuda a formular preguntas sobre infiltración y retención de agua.",
          ],
          facts: [["Estructura", "Los agregados estables dejan poros para que circule el agua y el aire. El tránsito de maquinaria o trabajar el suelo demasiado húmedo puede compactarlo."], ["En el lote", "Compare varios puntos y profundidades. Un solo rincón puede no representar todo el terreno."]],
          questions: [
            { prompt: "¿Qué combinación ayuda a observar la condición física del suelo?", options: ["Solo su color", "Infiltración, agregados, costra y raíces", "El tamaño del cultivo vecino"], answer: 1, why: "Varias señales del lote dan más información que el color por sí solo." },
            { prompt: "¿Qué indica una prueba de textura hecha con la mano?", options: ["Una orientación aproximada, no un análisis completo", "La cantidad exacta de nutrientes disponibles", "El rendimiento que tendrá la cosecha"], answer: 0, why: "La sensación al tacto orienta sobre arena, limo y arcilla, pero no mide nutrientes ni rendimiento." },
          ],
        },
        {
          title: "Cubra el suelo y cuide su estructura",
          paragraphs: [
            "La lluvia que golpea suelo desnudo puede desprender partículas y llevarlas cuesta abajo. Una cobertura viva o residuos vegetales reducen el impacto directo, moderan la evaporación y pueden ayudar a mantener una temperatura más estable. La cobertura adecuada depende del cultivo, del agua disponible y del manejo local.",
            "Los residuos de cosecha también aportan materia orgánica al descomponerse. No siempre conviene dejar todo el residuo: considere si se necesita como alimento animal, combustible o para controlar enfermedades. Evite quemarlo como práctica rutinaria; consulte alternativas de manejo y las reglas de su zona.",
          ],
          facts: [["Materia orgánica", "Mejora gradualmente algunas propiedades físicas y biológicas. No reemplaza por sí sola todos los nutrientes que extrae la cosecha."], ["Compactación", "Trabajar cuando el suelo está muy mojado puede apretarlo. Limite pasadas y use caminos definidos cuando sea posible."]],
          questions: [
            { prompt: "¿Qué puede lograr una cobertura sobre suelo desnudo?", options: ["Aumentar el golpe de las gotas", "Reducir el impacto de la lluvia y la evaporación", "Garantizar que no aparezcan malezas"], answer: 1, why: "La cobertura protege la superficie, aunque no elimina todos los riesgos ni las malezas." },
            { prompt: "¿Qué afirmación sobre residuos y materia orgánica es correcta?", options: ["Los residuos siempre sustituyen cualquier fertilización", "Pueden aportar materia orgánica, según el manejo y el uso local", "Es obligatorio dejar todos los residuos en cada lote"], answer: 1, why: "Los residuos pueden beneficiar el suelo, pero hay que equilibrar usos, necesidades y riesgos." },
          ],
        },
        {
          title: "Alimente el cultivo con información",
          paragraphs: [
            "Nitrógeno, fósforo y potasio cumplen funciones distintas y las necesidades cambian según cultivo, etapa y suelo. Aplicar más fertilizante no garantiza más cosecha: una dosis excesiva puede desperdiciar dinero y contaminar agua. Las deficiencias también pueden tener causas distintas, como raíces dañadas o pH inadecuado.",
            "Un muestreo de suelo bien hecho permite orientar decisiones. Siga las indicaciones del laboratorio sobre profundidad, número de submuestras, herramientas y época. Lleve el resultado a un técnico local y anote producto, dosis, fecha y respuesta del cultivo. No copie automáticamente la dosis de otro lote.",
          ],
          facts: [["pH", "Influye en la disponibilidad de nutrientes. Corregirlo requiere medirlo y considerar el tipo de suelo y las recomendaciones técnicas."], ["Registro", "Anote qué aplicó y cuánto. El historial ayuda a evitar aplicaciones duplicadas y a evaluar el resultado."]],
          questions: [
            { prompt: "¿Qué conviene hacer antes de elegir una dosis de fertilizante?", options: ["Copiar la dosis del vecino", "Considerar cultivo, análisis y recomendación local", "Aplicar la cantidad más alta disponible"], answer: 1, why: "La dosis debe responder al cultivo y a las condiciones medidas del lote." },
            { prompt: "¿Para qué sirve anotar las aplicaciones?", options: ["Para llevar un historial y evaluar decisiones", "Para asegurar que nunca haya plagas", "Para reemplazar el análisis de suelo"], answer: 0, why: "Un registro mejora el seguimiento, pero no sustituye otras observaciones o análisis." },
          ],
        },
      ],
    },
    {
      id: "water", title: "Agua: riego, drenaje y conservación", duration: 18,
      description: "Conecte la necesidad del cultivo con la lluvia, el riego y el drenaje. Aprenda a observar cuándo el lote necesita agua y cuándo sobra.",
      outcomes: ["Reconocer etapas sensibles a falta de agua", "Regar según observaciones y disponibilidad", "Identificar señales de exceso de agua y mejorar el drenaje"],
      lessons: [
        {
          title: "El cultivo no necesita lo mismo todo el ciclo",
          paragraphs: [
            "La demanda de agua depende del cultivo, su etapa, el clima y el suelo. Una planta pequeña cubre poca superficie; un cultivo desarrollado puede transpirar más. La floración y el llenado de grano suelen ser etapas sensibles para muchos cultivos, pero el calendario exacto cambia según la especie y la variedad.",
            "La lluvia de una estación meteorológica no siempre representa cada rincón del lote. Compare el pronóstico con la humedad del suelo, el estado de las plantas y los registros locales. Rooti usa datos climáticos de una celda amplia: sirven para comparar escenarios, no para sustituir la observación del terreno.",
          ],
          facts: [["Evapotranspiración", "Combina evaporación del suelo y transpiración de las plantas. Temperatura, viento, humedad y radiación influyen en ella."], ["Etapas", "Anote fechas de emergencia, floración y cosecha para relacionar agua disponible y respuesta del cultivo."]],
          questions: [
            { prompt: "¿Qué factores influyen en la necesidad de agua del cultivo?", options: ["Solo el nombre del cultivo", "Cultivo, etapa, clima y suelo", "Únicamente el día de siembra"], answer: 1, why: "La demanda cambia con el desarrollo y las condiciones del lote y del tiempo." },
            { prompt: "¿Cómo debe usarse una estimación climática amplia?", options: ["Como comparación que se complementa con observaciones del lote", "Como medida exacta para cada planta", "Como sustituto del pronóstico y del criterio local"], answer: 0, why: "Los datos regionales orientan, pero no describen cada parcela con exactitud." },
          ],
        },
        {
          title: "Riegue con intención",
          paragraphs: [
            "Antes de regar, revise humedad en más de un punto y a una profundidad donde haya raíces. La superficie puede verse seca aunque la zona radicular conserve agua, o puede estar húmeda arriba y seca más abajo. Las plantas marchitas al mediodía no siempre necesitan riego: observe si se recuperan al atardecer y busque otras señales.",
            "Cuando sea posible, aplique agua de forma pareja y evite que escurra fuera del lote. El goteo, los surcos y la aspersión tienen costos y limitaciones distintas. El viento puede desviar aspersores; una mala nivelación puede dejar zonas con exceso y otras secas. Ajuste horarios y caudales al sistema disponible y a la seguridad del agua.",
          ],
          facts: [["Uniformidad", "Revise varios puntos del lote después del riego. Una diferencia persistente puede señalar obstrucciones o problemas de distribución."], ["Ahorro", "Reparar fugas, limpiar filtros según indicación y regar sin escurrimiento visible son pasos prácticos de revisión."]],
          questions: [
            { prompt: "¿Qué revisión ayuda a decidir si hace falta regar?", options: ["Mirar solo la superficie", "Comprobar humedad a distintas profundidades en varios puntos", "Esperar a que todas las hojas se marchiten"], answer: 1, why: "La zona de raíces y la variación entre puntos importan más que una sola señal superficial." },
            { prompt: "¿Qué indica que el sistema podría distribuir mal el agua?", options: ["Unas zonas quedan encharcadas y otras secas", "El cultivo tiene varias etapas", "El lote recibe lluvia en invierno"], answer: 0, why: "Esa diferencia puede deberse a nivelación, presión, obstrucciones o diseño." },
          ],
        },
        {
          title: "Reconozca el exceso y conserve agua",
          paragraphs: [
            "El exceso de agua desplaza el aire de los poros. Algunas raíces se asfixian y aumenta el riesgo de enfermedades. Señales posibles son agua estancada, olor a suelo reducido, raíces oscuras o amarillamiento; confirme el diagnóstico antes de cambiar fertilización o aplicar productos.",
            "El drenaje depende de relieve, textura, compactación y salidas de agua. Mantenga despejadas las rutas de drenaje sin trasladar el problema a vecinos o quebradas. En pendientes, curvas a nivel, barreras vegetales y cobertura pueden ayudar a frenar escorrentía; la solución correcta requiere considerar la parcela y las normas locales.",
          ],
          facts: [["Encharcamiento", "Anote dónde aparece y cuánto dura después de la lluvia o el riego. El patrón ayuda a encontrar causas."], ["Proteja las fuentes", "Evite lavar equipos o verter mezclas cerca de pozos, canales y cuerpos de agua."]],
          questions: [
            { prompt: "¿Qué puede pasar cuando el suelo permanece saturado?", options: ["Las raíces siempre reciben más oxígeno", "Puede faltar aire en la zona radicular", "El cultivo deja de necesitar nutrientes"], answer: 1, why: "El agua ocupa los poros y puede limitar el oxígeno que necesitan las raíces." },
            { prompt: "¿Qué conviene registrar ante encharcamientos?", options: ["Ubicación y duración", "Solo el color de las hojas", "El precio de la semilla"], answer: 0, why: "El patrón y la duración ayudan a distinguir problemas de relieve, compactación o drenaje." },
          ],
        },
      ],
    },
    {
      id: "seeds", title: "Semillas y establecimiento del cultivo", duration: 16,
      description: "Prepare el inicio del ciclo: elija semillas apropiadas, siembre a una profundidad adecuada y revise la emergencia del cultivo.",
      outcomes: ["Elegir semilla adaptada y de procedencia confiable", "Ajustar profundidad y espaciamiento a la especie", "Comprobar emergencia y registrar fechas"],
      lessons: [
        {
          title: "Elija semilla para su zona y su objetivo",
          paragraphs: [
            "Una variedad puede diferir en duración, tolerancia al clima, resistencia a enfermedades y destino de mercado. Antes de comprar, confirme que esté recomendada para su zona y temporada, que la etiqueta corresponda a la especie y variedad, y que el lote de semilla tenga procedencia clara.",
            "Revise fecha, almacenamiento, sello y condiciones del empaque. Semillas expuestas a humedad o calor pueden perder viabilidad. Si conserva semilla propia, seleccione plantas sanas y maduras, seque y almacene correctamente, y tenga en cuenta que algunas variedades híbridas no mantienen las mismas características al guardar semilla de la cosecha.",
          ],
          facts: [["Germinación", "Una prueba con una muestra pequeña permite estimar cuántas semillas brotan en condiciones controladas; el resultado no garantiza la emergencia en campo."], ["Adaptación", "Consulte a INIAP, extensión local o proveedores confiables sobre variedades y calendario vigentes en su zona."]],
          questions: [
            { prompt: "¿Qué debe revisar al escoger semilla?", options: ["Adaptación a zona y temporada, identificación y procedencia", "Solo el color del empaque", "La variedad que sembró otra finca sin comprobar"], answer: 0, why: "La adaptación y una procedencia clara ayudan a reducir riesgos de establecimiento." },
            { prompt: "¿Qué permite una prueba de germinación?", options: ["Estimar brotes en una muestra bajo ciertas condiciones", "Asegurar exactamente el rendimiento final", "Saber si el suelo tiene suficiente fósforo"], answer: 0, why: "La prueba estima viabilidad, pero el campo añade humedad, plagas y otras condiciones." },
          ],
        },
        {
          title: "Prepare la cama y siembre correctamente",
          paragraphs: [
            "Una cama de siembra adecuada debe permitir contacto entre semilla y suelo sin quedar tan pulverizada que forme costra. La preparación depende del cultivo, la humedad y el tipo de suelo. Trabajar suelo mojado puede compactarlo; labrar de más puede deshacer agregados y dejarlo expuesto a erosión.",
            "Profundidad y espaciamiento dependen de tamaño de semilla, suelo, humedad, variedad y sistema de producción. Siga la etiqueta y la recomendación local. Si se siembra demasiado profundo, la plántula puede no llegar a la superficie; demasiado superficial puede dejar la semilla seca o expuesta a aves. Calibre la sembradora y compruebe varias filas antes de continuar.",
          ],
          facts: [["Calibración", "Revise distancia entre semillas, profundidad y cantidad depositada en varios puntos antes de sembrar todo el terreno."], ["Emergencia", "Cuente plantas en tramos representativos. Compare zonas buenas y malas para detectar diferencias de humedad o profundidad."]],
          questions: [
            { prompt: "¿De qué dependen la profundidad y el espaciamiento?", options: ["Solo de la preferencia del operador", "Cultivo, semilla, suelo y recomendación local", "Del número de vecinos"], answer: 1, why: "Las condiciones y el sistema de cultivo determinan el establecimiento apropiado." },
            { prompt: "¿Qué conviene comprobar al calibrar una sembradora?", options: ["Profundidad y distancia en varias filas", "Únicamente el color de la máquina", "El precio de venta de la cosecha"], answer: 0, why: "La calibración ayuda a lograr una distribución uniforme antes de sembrar todo el lote." },
          ],
        },
        {
          title: "Acompañe la emergencia",
          paragraphs: [
            "Después de sembrar, revise el lote pronto y repita la observación. La emergencia desigual puede relacionarse con profundidad, costra, falta o exceso de agua, calidad de semilla, insectos u hongos. Compare sectores y escarbe con cuidado algunas semillas para ver si germinaron, se secaron o fueron dañadas.",
            "Si hay fallas, estime cuántas plantas quedaron y consulte si resembrar tiene sentido para esa especie y fecha. Resembrar tarde puede generar plantas de edades distintas y competencia. Registre fecha, variedad, lote de semilla, condiciones de siembra y porcentaje aproximado de emergencia: ese historial será útil para el próximo ciclo.",
          ],
          facts: [["Calendario", "Planifique considerando duración del ciclo, disponibilidad de agua, clima esperado y tiempo para preparar el terreno."], ["Registro", "Una libreta o foto fechada puede bastar para comparar cómo respondió cada sector del lote."]],
          questions: [
            { prompt: "¿Qué ayuda a investigar una emergencia irregular?", options: ["Comparar sectores y revisar algunas semillas con cuidado", "Aplicar cualquier producto de inmediato", "Ignorar las zonas que no brotaron"], answer: 0, why: "Comparar y observar permite buscar causas antes de intervenir." },
            { prompt: "¿Qué información conviene registrar para el siguiente ciclo?", options: ["Variedad, fecha y condiciones de siembra", "Solo el nombre del propietario", "La fase de la luna sin datos del lote"], answer: 0, why: "Los registros del lote ayudan a relacionar prácticas y resultados." },
          ],
        },
      ],
    },
    {
      id: "pests", title: "Manejo integrado de plagas y enfermedades", duration: 18,
      description: "Aprenda a observar antes de actuar y a combinar prevención, prácticas culturales y controles seguros cuando sean necesarios.",
      outcomes: ["Distinguir daño, plaga y enfermedad", "Monitorear el lote con registros", "Priorizar prevención y usar controles de forma responsable"],
      lessons: [
        {
          title: "Observe antes de diagnosticar",
          paragraphs: [
            "Una hoja dañada no identifica por sí sola la causa. Puede deberse a insectos, hongos, bacterias, falta de nutrientes, sequía, herbicida o daño mecánico. Mire ambas caras de las hojas, tallos, raíces y el patrón dentro del lote. Compare plantas sanas y afectadas.",
            "Monitoree con una ruta repetible y puntos distribuidos, no solo el borde o la zona más afectada. Anote fecha, etapa del cultivo, cantidad de plantas revisadas, organismos observados y nivel de daño. Tome fotos nítidas y consulte a un técnico cuando no pueda distinguir la causa; aplicar un producto equivocado puede empeorar el problema.",
          ],
          facts: [["Muestreo", "Revise plantas en varios sectores y repita el recorrido. El tamaño de muestra adecuado depende del cultivo y de la plaga."], ["Organismos benéficos", "No todo insecto es plaga. Algunos depredan o parasitan organismos que dañan el cultivo."]],
          questions: [
            { prompt: "¿Qué debe hacer ante una hoja dañada sin causa clara?", options: ["Diagnosticar por una sola mancha y fumigar", "Observar varias partes y plantas, registrar y confirmar", "Arrancar todo el cultivo"], answer: 1, why: "El patrón y la observación de más señales ayudan a distinguir causas." },
            { prompt: "¿Por qué conviene reconocer organismos benéficos?", options: ["Porque algunos ayudan a controlar plagas", "Porque todos dañan el cultivo", "Porque reemplazan siempre el monitoreo"], answer: 0, why: "Conservar enemigos naturales puede apoyar el manejo integrado." },
          ],
        },
        {
          title: "Prevenga con prácticas del cultivo",
          paragraphs: [
            "El manejo integrado combina varias herramientas. Semilla sana, variedades adecuadas, rotación, fechas oportunas, eliminación responsable de plantas muy afectadas y manejo de residuos pueden reducir la presión de algunos problemas. Ninguna práctica funciona contra todas las plagas ni en todas las fincas.",
            "Revise drenaje, nutrición y densidad: plantas estresadas o un follaje demasiado denso pueden favorecer ciertos problemas. Mantenga herramientas limpias cuando sea pertinente y evite mover suelo o restos contaminados entre sectores. Consulte recomendaciones locales para no destruir hábitats de organismos benéficos ni trasladar plagas a otros lotes.",
          ],
          facts: [["Rotación", "Cambiar de familia puede interrumpir algunos ciclos de plagas, pero no todos; considere hospedantes alternativos y cultivos vecinos."], ["Umbral", "El nivel para intervenir varía según organismo, etapa, valor del cultivo y costo de control. Use guías locales." ]],
          questions: [
            { prompt: "¿Qué describe mejor el manejo integrado?", options: ["Usar una sola herramienta en todo caso", "Combinar prevención, monitoreo y controles apropiados", "Esperar a perder la cosecha para actuar"], answer: 1, why: "La estrategia combina herramientas según el diagnóstico y el contexto." },
            { prompt: "¿La rotación elimina cualquier plaga?", options: ["Sí, siempre", "No; puede interrumpir algunos ciclos y requiere revisar hospedantes", "Solo si se repite el mismo cultivo"], answer: 1, why: "Algunas plagas tienen otros hospedantes o se desplazan entre lotes." },
          ],
        },
        {
          title: "Intervenga con seguridad y evalúe",
          paragraphs: [
            "Si el monitoreo y la recomendación técnica indican intervenir, elija un método registrado para ese cultivo y problema. Lea y siga la etiqueta completa: dosis, equipo de protección, intervalo antes de cosecha, reingreso, almacenamiento y disposición. Nunca mezcle productos sin una indicación autorizada.",
            "Proteja a las personas, animales, polinizadores y fuentes de agua. Evite deriva hacia casas, escuelas, canales y cultivos vecinos. No reutilice envases ni los queme; siga el sistema local de devolución. Después del control, vuelva a monitorear para saber si funcionó y si apareció un efecto no deseado. Guarde fecha, producto y resultado.",
          ],
          facts: [["Seguridad", "La etiqueta y las normas locales mandan. Si falta equipo o capacitación, no aplique y solicite apoyo."], ["Resistencia", "Repetir el mismo modo de acción puede favorecer resistencia. Alterne estrategias siguiendo asesoría técnica y etiqueta."]],
          questions: [
            { prompt: "¿Qué debe guiar el uso de un producto de control?", options: ["La etiqueta, el registro y la recomendación local", "Una mezcla sugerida sin identificar el problema", "Una dosis mayor para terminar más rápido"], answer: 0, why: "La etiqueta contiene condiciones esenciales de eficacia y seguridad." },
            { prompt: "¿Qué hacer después de una intervención?", options: ["Monitorear de nuevo y registrar resultado y fecha", "Asumir que siempre funcionó", "Repetir de inmediato la misma aplicación"], answer: 0, why: "El seguimiento muestra si el manejo funcionó y ayuda a evitar aplicaciones innecesarias." },
          ],
        },
      ],
    },
  ],
  en: [
    {
      id: "rotation", title: "Crop rotation", duration: 12,
      description: "Learn to alternate crops and plant families, plan sequences, reduce repetition, and keep soil covered.",
      outcomes: ["Recognize crop families and roles", "Plan sequences around water, timing, and drainage", "Record results to improve the next season"],
    },
    {
      id: "soil", title: "Living soil and fertility", duration: 18,
      description: "Observe soil before changing it. Texture, structure, cover, and nutrients all help guide decisions about soil care.",
      outcomes: ["Observe physical signs in the field", "Protect the surface and make thoughtful use of residues", "Use soil tests and local guidance for fertility"],
      lessons: [
        {
          title: "Look beyond soil color",
          paragraphs: [
            "Soil supports roots, stores water and air, and hosts organisms that transform residues. Color can offer clues, but it cannot tell you by itself whether soil is healthy. Observe how it crumbles, whether a crust forms after rain, if water stands, and whether roots can penetrate.",
            "Texture describes the proportions of sand, silt, and clay. A moist handful can offer a rough indication: sand feels gritty, clay is stickier, and silt feels smooth. This field test does not replace a soil test, but it can help you ask better questions about infiltration and water storage.",
          ],
          facts: [["Structure", "Stable aggregates leave pores for water and air. Traffic or tillage while soil is very wet can compact it."], ["In the field", "Compare several locations and depths. One corner may not represent the whole plot."]],
          questions: [
            { prompt: "Which combination helps you observe physical soil condition?", options: ["Color alone", "Infiltration, aggregates, crusting, and roots", "The size of a neighboring crop"], answer: 1, why: "Several field signs provide more information than color by itself." },
            { prompt: "What does a hand texture test tell you?", options: ["A rough indication, not a complete soil analysis", "The exact amount of available nutrients", "The harvest yield you will get"], answer: 0, why: "Touch can suggest sand, silt, and clay, but it does not measure nutrients or yield." },
          ],
        },
        {
          title: "Cover soil and protect its structure",
          paragraphs: [
            "Rain striking bare soil can detach particles and carry them downhill. Living cover or plant residues reduce direct impact, moderate evaporation, and can help keep temperatures more stable. The right cover depends on the crop, available water, and local management.",
            "Crop residues also add organic matter as they decompose. Keeping every residue is not always practical: consider livestock feed, fuel, or disease management. Avoid routine burning and ask about local alternatives and rules.",
          ],
          facts: [["Organic matter", "It can gradually improve some physical and biological properties. By itself, it does not replace every nutrient removed at harvest."], ["Compaction", "Working soil when it is very wet can squeeze it. Limit passes and use defined traffic lanes where possible."]],
          questions: [
            { prompt: "What can cover do on bare soil?", options: ["Increase raindrop impact", "Reduce rain impact and evaporation", "Guarantee that no weeds grow"], answer: 1, why: "Cover protects the surface, although it does not remove every risk or weed." },
            { prompt: "Which statement about residues and organic matter is accurate?", options: ["Residues always replace all fertilizer", "They can add organic matter, depending on local uses and management", "Every field must keep all residues"], answer: 1, why: "Residues can benefit soil, while uses, needs, and risks still need balancing." },
          ],
        },
        {
          title: "Feed crops with evidence",
          paragraphs: [
            "Nitrogen, phosphorus, and potassium have different roles, and crop needs change with species, growth stage, and soil. More fertilizer does not guarantee a larger harvest: excess can waste money and pollute water. Deficiencies can also have other causes, such as damaged roots or unsuitable pH.",
            "A well-collected soil sample can guide decisions. Follow the lab's directions for depth, number of subsamples, tools, and timing. Review results with a local adviser and record product, rate, date, and crop response. Do not automatically copy another plot's fertilizer rate.",
          ],
          facts: [["pH", "It affects nutrient availability. Adjustments require a measurement and advice that considers soil type."], ["Records", "Write down what you applied and how much. A history helps prevent duplicate applications and assess results."]],
          questions: [
            { prompt: "What should you consider before choosing a fertilizer rate?", options: ["Copy a neighbor's rate", "The crop, soil test, and local recommendation", "Apply the largest amount available"], answer: 1, why: "Rates should respond to the crop and measured field conditions." },
            { prompt: "Why keep application records?", options: ["To track decisions and evaluate results", "To guarantee there will be no pests", "To replace soil testing"], answer: 0, why: "Records improve follow-up but do not replace other observations or tests." },
          ],
        },
      ],
    },
    {
      id: "water", title: "Water: irrigation, drainage, and conservation", duration: 18,
      description: "Connect crop water needs with rainfall, irrigation, and drainage. Learn to notice when a field needs water and when it has too much.",
      outcomes: ["Recognize growth stages sensitive to water stress", "Irrigate using observations and available supply", "Identify excess water and improve drainage"],
      lessons: [
        {
          title: "Crops do not need the same water all season",
          paragraphs: [
            "Water demand depends on crop, growth stage, weather, and soil. A small plant covers little ground; a mature canopy may transpire more. Flowering and grain filling are sensitive stages for many crops, but exact timing changes by species and variety.",
            "Rain at a weather station may not represent every part of a field. Compare forecasts with soil moisture, plant condition, and local records. Rooti uses climate data from a broad grid cell: it helps compare scenarios but cannot replace field observation.",
          ],
          facts: [["Evapotranspiration", "It combines evaporation from soil and transpiration from plants. Temperature, wind, humidity, and radiation affect it."], ["Growth stages", "Record emergence, flowering, and harvest dates to connect water availability with crop response."]],
          questions: [
            { prompt: "What affects crop water demand?", options: ["Only the crop name", "Crop, growth stage, weather, and soil", "Only the planting date"], answer: 1, why: "Demand changes with growth and with field and weather conditions." },
            { prompt: "How should broad climate estimates be used?", options: ["As comparisons combined with field observations", "As exact measurements for every plant", "As a replacement for local forecasts and judgment"], answer: 0, why: "Regional data can guide decisions, but they do not describe each plot exactly." },
          ],
        },
        {
          title: "Irrigate with a purpose",
          paragraphs: [
            "Before irrigating, check moisture at more than one spot and at a depth where roots are active. The surface may look dry while the root zone still has water, or the top may be wet while deeper soil is dry. Midday wilting alone does not always mean irrigation is needed; see whether plants recover later and look for other signs.",
            "When possible, apply water evenly and avoid runoff. Drip, furrow, and sprinkler systems have different costs and limits. Wind can move sprinklers; poor leveling can leave some areas wet and others dry. Adjust timing and flow to your system and water safety requirements.",
          ],
          facts: [["Uniformity", "Check several areas after irrigation. Persistent differences may point to clogs or distribution problems."], ["Efficiency", "Fix leaks, clean filters as directed, and look for visible runoff as practical checks."]],
          questions: [
            { prompt: "What check helps decide whether irrigation is needed?", options: ["Look only at the surface", "Check moisture at different depths and locations", "Wait until every leaf wilts"], answer: 1, why: "The root zone and variation across the field matter more than one surface sign." },
            { prompt: "What may indicate uneven water distribution?", options: ["Some areas are waterlogged while others are dry", "The crop has multiple growth stages", "The field receives winter rain"], answer: 0, why: "Differences can result from leveling, pressure, clogs, or system design." },
          ],
        },
        {
          title: "Spot excess water and conserve it",
          paragraphs: [
            "Excess water pushes air out of soil pores. Some roots can suffocate, and disease risk may increase. Possible signs include standing water, reduced-soil odors, dark roots, or yellowing; confirm the cause before changing fertilizer or applying products.",
            "Drainage depends on slope, texture, compaction, and outlets. Keep drainage routes clear without transferring the problem to neighbors or streams. On slopes, contour planting, vegetative barriers, and cover can help slow runoff; the right solution depends on the field and local rules.",
          ],
          facts: [["Waterlogging", "Record where it appears and how long it lasts after rain or irrigation. Patterns help identify causes."], ["Protect water sources", "Do not wash equipment or pour mixtures near wells, canals, or waterways."]],
          questions: [
            { prompt: "What can happen when soil remains saturated?", options: ["Roots always receive more oxygen", "The root zone may lack air", "Crops stop needing nutrients"], answer: 1, why: "Water fills pores and can limit oxygen that roots need." },
            { prompt: "What should you record when waterlogging occurs?", options: ["Location and duration", "Leaf color alone", "Seed price"], answer: 0, why: "Patterns and duration help distinguish slope, compaction, and drainage issues." },
          ],
        },
      ],
    },
    {
      id: "seeds", title: "Seeds and crop establishment", duration: 16,
      description: "Set up a strong start: choose suitable seed, plant at an appropriate depth, and check crop emergence.",
      outcomes: ["Choose adapted seed from a reliable source", "Match depth and spacing to the crop", "Check emergence and record dates"],
      lessons: [
        {
          title: "Choose seed for your area and goal",
          paragraphs: [
            "Varieties can differ in maturity, climate tolerance, disease resistance, and market use. Before buying, confirm the variety is recommended for your area and season, check that the label matches the crop and variety, and use a reliable source.",
            "Check the date, storage, seal, and package condition. Seed exposed to moisture or heat may lose viability. If saving seed, select healthy mature plants, dry and store it properly, and remember that some hybrids do not retain the same traits in saved seed.",
          ],
          facts: [["Germination", "A small sample test can estimate how many seeds sprout under controlled conditions; it cannot guarantee field emergence."], ["Adaptation", "Ask local extension services or trusted suppliers about current varieties and calendars for your area."]],
          questions: [
            { prompt: "What should you check when choosing seed?", options: ["Adaptation, identification, season, and source", "Package color alone", "A variety from another farm without checking"], answer: 0, why: "Adaptation and a clear source help reduce establishment risk." },
            { prompt: "What does a germination test tell you?", options: ["An estimate of sprouting in a sample under certain conditions", "The exact final yield", "Whether soil has enough phosphorus"], answer: 0, why: "A test estimates viability, while field conditions add other risks." },
          ],
        },
        {
          title: "Prepare the seedbed and plant well",
          paragraphs: [
            "A suitable seedbed supports contact between seed and soil without being so pulverized that it crusts. Preparation depends on crop, moisture, and soil type. Working wet soil can compact it; excessive tillage can break aggregates and leave the surface exposed to erosion.",
            "Planting depth and spacing depend on seed size, soil, moisture, variety, and production system. Follow the label and local guidance. Too deep and seedlings may not reach the surface; too shallow and seed may dry out or be exposed to birds. Calibrate the planter and check several rows before continuing.",
          ],
          facts: [["Calibration", "Check seed spacing, depth, and delivery at several points before planting the full field."], ["Emergence", "Count plants along representative rows. Compare good and poor areas to spot moisture or depth differences."]],
          questions: [
            { prompt: "What determines planting depth and spacing?", options: ["Only the operator's preference", "Crop, seed, soil, and local guidance", "The number of neighbors"], answer: 1, why: "Conditions and the production system guide appropriate establishment." },
            { prompt: "What should you check when calibrating a planter?", options: ["Depth and spacing across several rows", "Machine color only", "The crop's selling price"], answer: 0, why: "Calibration supports uniform planting before you cover the whole field." },
          ],
        },
        {
          title: "Follow crop emergence",
          paragraphs: [
            "Check the field soon after planting and repeat the observation. Uneven emergence may relate to depth, crusting, too little or too much water, seed quality, insects, or fungi. Compare areas and carefully dig up a few seeds to see whether they sprouted, dried out, or were damaged.",
            "If there are gaps, estimate how many plants remain and ask whether replanting makes sense for the crop and date. Late replanting can create plants of different ages and competition. Record planting date, variety, seed lot, conditions, and approximate emergence to guide the next season.",
          ],
          facts: [["Calendar", "Plan for crop duration, water availability, likely weather, and time to prepare the field."], ["Records", "A notebook or dated photo can help compare how each part of the field performed."]],
          questions: [
            { prompt: "What helps investigate uneven emergence?", options: ["Compare areas and carefully inspect some seeds", "Apply any product immediately", "Ignore areas that did not emerge"], answer: 0, why: "Comparison and observation help identify causes before acting." },
            { prompt: "What information is useful for next season?", options: ["Variety, date, and planting conditions", "Owner name only", "Moon phase without field records"], answer: 0, why: "Field records help connect practices with outcomes." },
          ],
        },
      ],
    },
    {
      id: "pests", title: "Integrated pest and disease management", duration: 18,
      description: "Learn to observe before acting and combine prevention, crop practices, and safe controls when they are needed.",
      outcomes: ["Distinguish damage, pests, and disease symptoms", "Monitor the field and keep records", "Prioritize prevention and use controls responsibly"],
      lessons: [
        {
          title: "Observe before diagnosing",
          paragraphs: [
            "A damaged leaf alone does not identify the cause. It may result from insects, fungi, bacteria, nutrient issues, drought, herbicide, or mechanical damage. Look on both sides of leaves, stems, roots, and at the pattern across the field. Compare healthy and affected plants.",
            "Monitor with a repeatable route and points across the field, not only the edge or the worst patch. Record date, crop stage, number of plants checked, organisms observed, and damage level. Take clear photos and ask a local adviser if the cause is uncertain; the wrong product can make things worse.",
          ],
          facts: [["Sampling", "Check plants across multiple areas and repeat the route. Sample size depends on crop and pest."], ["Beneficial organisms", "Not every insect is a pest. Some prey on or parasitize crop-damaging organisms."]],
          questions: [
            { prompt: "What should you do when a leaf is damaged and the cause is unclear?", options: ["Diagnose from one spot and spray", "Check several plants and signs, record, and confirm", "Remove the entire crop"], answer: 1, why: "Patterns and multiple signs help distinguish possible causes." },
            { prompt: "Why recognize beneficial organisms?", options: ["Some help control pests", "They all damage crops", "They replace monitoring"], answer: 0, why: "Protecting natural enemies can support integrated management." },
          ],
        },
        {
          title: "Prevent with crop practices",
          paragraphs: [
            "Integrated management combines tools. Healthy seed, adapted varieties, rotation, timely planting, responsible removal of heavily affected plants, and residue management can reduce pressure from some problems. No practice works against every pest in every farm.",
            "Check drainage, nutrition, and plant density: stressed plants or very dense foliage can favor certain problems. Clean tools when relevant and avoid moving contaminated soil or residue between areas. Follow local advice to protect beneficial habitats and avoid spreading pests to other plots.",
          ],
          facts: [["Rotation", "Changing crop families can interrupt some pest cycles, but not all; consider alternate hosts and neighboring fields."], ["Action threshold", "The level for intervention varies by organism, crop stage, crop value, and control cost. Use local guidance."]],
          questions: [
            { prompt: "What best describes integrated pest management?", options: ["Use one tool for every problem", "Combine prevention, monitoring, and suitable controls", "Wait until the crop is lost"], answer: 1, why: "The strategy combines tools based on diagnosis and context." },
            { prompt: "Does crop rotation eliminate every pest?", options: ["Yes, always", "No; it may interrupt some cycles, and alternate hosts matter", "Only when the same crop is repeated"], answer: 1, why: "Some pests have other hosts or move between fields." },
          ],
        },
        {
          title: "Intervene safely and evaluate",
          paragraphs: [
            "If monitoring and local advice indicate intervention, choose a method registered for the crop and problem. Read and follow the full label: rate, protective equipment, preharvest interval, reentry, storage, and disposal. Never mix products without authorized directions.",
            "Protect people, animals, pollinators, and water sources. Prevent drift toward homes, schools, canals, and neighboring crops. Do not reuse or burn containers; follow local return programs. Monitor again after treatment to see whether it worked and whether unwanted effects appeared. Record date, product, and outcome.",
          ],
          facts: [["Safety", "The label and local rules govern. If equipment or training is missing, do not apply; ask for support."], ["Resistance", "Repeating one mode of action can favor resistance. Rotate strategies with technical advice and label directions."]],
          questions: [
            { prompt: "What should guide the use of a control product?", options: ["The label, registration, and local advice", "An unverified mix with no diagnosis", "A higher rate to finish faster"], answer: 0, why: "The label includes essential directions for effectiveness and safety." },
            { prompt: "What should you do after an intervention?", options: ["Monitor again and record results and date", "Assume it always worked", "Immediately repeat the same application"], answer: 0, why: "Follow-up shows whether management worked and helps avoid unnecessary applications." },
          ],
        },
      ],
    },
  ],
};
