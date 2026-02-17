function [dfmat]=GeneralExe2012grupo(foto,nfoto,npixescala,dpomat,automatico,delta)

longescala=100*ones(1,length(nfoto));

contdimfrac=0;dfmat={};

for ipri=1:size(nfoto,1)
    
    jpri=1;
    if automatico==1
%       nomarchivo=strcat(nfoto{ipri},'-',int2str(jpri),'.jpg'); %CAMBIO
        nomarchivo=strcat(nfoto{ipri},'.jpg');
        if ~exist(nomarchivo)
            nomarchivo=strcat(nfoto{ipri},'.png');
        end
        if ~exist(nomarchivo)
            nomarchivo=strcat(nfoto{ipri},'.bmp');
        end
        if ~exist(nomarchivo)
            nomarchivo=strcat(nfoto{ipri},'.tif');
        end
    else
        nomarchivo=nfoto{ipri};
    end
    while (exist(nomarchivo)==2)
        imagen_inicial=imread(nomarchivo);
        if size(imagen_inicial,3)==3
            imagenbn=rgb2gray(imagen_inicial);
        else
            imagenbn=imagen_inicial;
        end
        i2d=uint8(double(imagenbn).*double(roicolor(imagenbn,0,240)));
%         npix=npixescala(ipri);escala=longescala(ipri);dpom=dpomat(ipri);%CAMBIO
        npix=npixescala{ipri};escala=longescala(ipri);dpom=dpomat{ipri};
        
        [Rg,Ap,Df2012,npo2012,kf2012,zf2012,Jf2012,vol2012,masa2012,Asup2012,fallo]=dimfrac2012(i2d,escala,npix,dpom,delta);
                                     %Nuevas salidas
        contdimfrac=contdimfrac+1;
        
        dfmat{contdimfrac,1}=foto{ipri};
        dfmat{contdimfrac,2}=jpri;
        dfmat{contdimfrac,3}=Rg;
        dfmat{contdimfrac,4}=Ap;
        dfmat{contdimfrac,5}=round(npo2012);
        dfmat{contdimfrac,6}=Df2012;
        dfmat{contdimfrac,7}=kf2012;
        dfmat{contdimfrac,8}=zf2012; %Nueva salida: exp. de solape
        dfmat{contdimfrac,9}=Jf2012; %Nueva salida: índ. de coord.
        dfmat{contdimfrac,10}=vol2012; %Nueva salida: volumen
        dfmat{contdimfrac,11}=masa2012; %Nueva salida: masa
        dfmat{contdimfrac,12}=Asup2012; %Nueva salida: área sup.
        dfmat{contdimfrac,13}=delta;
        dfmat{contdimfrac,14}=fallo;
        
        jpri=jpri+1;
        nomarchivo=strcat(nfoto{ipri},'-',int2str(jpri));
    end
    
end
end