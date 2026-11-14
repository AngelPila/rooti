# Entorno genérico de ciencia de datos geoespacial (no contiene código del proyecto)
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ libexpat1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir earthaccess xarray netCDF4 h5netcdf h5py rioxarray rasterio \
    geopandas shapely pandas numpy scipy scikit-learn statsmodels matplotlib plotly \
    pystac-client planetary-computer odc-stac dask[distributed] duckdb xarray-spatial pint uncertainties requests jupyterlab
WORKDIR /work
EXPOSE 8888
CMD ["jupyter","lab","--ip=0.0.0.0","--no-browser","--allow-root"]
