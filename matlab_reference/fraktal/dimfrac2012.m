function [Rg,Ap,Df2012,npo2012,kf2012,zf2012,Jf2012,vol2012,masa2012,Asup2012,fallo]=dimfrac2012(i2d,escala,npix,dpo,delta)
%determina la dimension fractal del articulo 2006 comparado con el del 2010;
%utilia la ley potencial de z';
%Capta dobles soluciones, y toma menor, solución numérica por bisección;
%del metodo exponencial rechaza las particulas con doble solucion, y las particuls con npo<npolim, 
%por estar fuera del rango propio del modelo;

filmax=240;
filmin=10;
npolim=5; %limite, de manera que partículas menores no son admitidas;
fallo='-';
incr=0.0001;

a2=roicolor(i2d,filmin,filmax);
     
[I,J]=find(a2);
nele=size(I,1); %número de pixeles;

npix=(npix);
longitud_pixel=escala/npix; % (nm)
area_pixel=(longitud_pixel)^2; % (nm^2)
area_total=nele*area_pixel; % (nm^2)
Ap=area_total; %nm^2
xcg=sum(J)/nele;  %pixel
ycg=sum(I)/nele;  %pixel
x=J-xcg;  %pixel
y=I-ycg;  %pixel
x2=x.^2;  %pixel^2
y2=y.^2;  %pixel^2
r2=sum(x2)+sum(y2); %pixel2;
radio=sqrt(r2/nele);  %pixel
radio_giro=radio*longitud_pixel; %nm
% Variables
handles.correccion=getappdata(0,'Correccion');
handles.granulado=getappdata(0,'Granulado');

% Rg y m tridimensional (con corrección Rg 3D = Rg 2D + A*Rg 2D^B)
if strcmp(handles.correccion,'Si') && strcmp(handles.granulado,'Si')
m=1.86-1.3*(delta-1);
Rg=radio_giro+(((2.165-19.315*(delta-1))*10^-5)*(radio_giro^(2.928+5.414*(delta-1)))); %nm
dp=Rg*2;%nm
elseif strcmp(handles.correccion,'Si') && strcmp(handles.granulado,'Si_voxel')
m=1;
Rg=radio_giro+((2.165*10^-5)*(radio_giro^2.928)); %nm
dp=Rg*2;%nm
elseif strcmp(handles.correccion,'Si') && strcmp(handles.granulado,'No')
m=1;
Rg=radio_giro+((2.165*10^-5)*(radio_giro^2.928)); %nm
dp=Rg*2;%nm
elseif strcmp(handles.correccion,'No') && strcmp(handles.granulado,'Si_voxel')
m=1;
Rg=radio_giro; %nm
dp=Rg*2;%nm
elseif strcmp(handles.correccion,'No') && strcmp(handles.granulado,'No')
m=1;
Rg=radio_giro; %nm
dp=Rg*2;%nm
else
m=1.95;
Rg=radio_giro; %nm
dp=Rg*2;%nm
end

Df2012=0;npo2012=0;kf2012=0;zf2012=0;Jf2012=0;vol2012=0;masa2012=0;Asup2012=0;

%Df y npo (2010);
if strcmp(handles.granulado,'Si')
[df2, npo2, kf2, fun]=buscafractal2012(dp,dpo,1000000,Ap,m,delta);
 if (df2~=0)
    df1=df2+0.05;contaux=1;
    while (abs(df1-df2)>incr)&&(contaux<50)
        df1=df2;npo1=npo2;
        [df2, npo2, kf2, fun]=buscafractal2012(dp,dpo,npo1,Ap,m,delta);
        if (df2==0)   
            fallo='Df fuera rango';
            break;
        end
        contaux=contaux+1;
    end
 else
    fallo='Df fuera rango';
 end
else
    [df2, npo2, kf2, fun]=buscafractal2018(dp,100000000,Ap,m,escala,npix);
 if (df2~=0)
    df1=df2+0.05;contaux=1;
    while (abs(df1-df2)>incr)&&(contaux<50)
        df1=df2;npo1=npo2;
        [df2, npo2, kf2, fun]=buscafractal2018(dp,npo1,Ap,m,escala,npix);
        if (df2==0)   
            fallo='Df fuera rango';
            break;
        end
        contaux=contaux+1;
    end
 else
    fallo='Df fuera rango';
 end
end
if fun~=0
    fallo='No hay convergencia';
elseif npo2>=npolim
    Df2012=df2;
    kf2012=kf2;
    if strcmp(handles.granulado,'No')
    npo2012=npo2;
    zf2012=(log(npo2012)/(log((1/2)+(1/4)*pi*npo2012)))-1+(1.5+1-(log(npo2012)/(log((1/2)+(1/4)*pi*npo2012))))^(((Df2012-1)/2)^m); %Nueva salida: exp. de solape
    Jf2012=0;
    vol2012=npo2012*((longitud_pixel^3)); %Nueva salida: volumen del objeto
    masa2012=0; %Nueva salida: masa 
    Asup2012=npo2012*(4*(longitud_pixel^2)); %Nueva salida: área superficial del objeto    
    elseif strcmp(handles.granulado,'Si')
           npo2012=npo2;
           zf2012=(log(npo2012)/(log(0.8488*npo2012+0.1512)))-1+((1.5/(1+0.3005/log(npo2012)))+1-(log(npo2012)/(log(0.8488*npo2012+0.1512))))^(((Df2012-1)/2)^m); %Nueva salida: exp. de solape
           Jf2012=2+(1.5*(delta-1)*(Df2012-1))+(1.85+(0.0191*(kf2012^3.609))+(1.45*(npo2012^(-0.3901))))*10^(-8)*Df2012^(17+6.2*(delta-1));
           vol2012=npo2012*((1/6*pi*dpo^3)*(1-(Jf2012*((4*delta^3-6*delta^2+2)/(8*delta^3))))); %Nueva salida: volumen aglomerado
           masa2012=1.85e-06*vol2012; %Nueva salida: masa aglomerado (densidad del hollín= 1.85e-06 fg/nm^3)
           Asup2012=npo2012*((pi*dpo^2)*(1-(Jf2012*((delta-1)/(2*delta))))); %Nueva salida: área superficial aglomerado
        else
            zf2012=(log(npo2)/(log((1/2)+(1/4)*pi*npo2)))-1+(1.5+1-(log(npo2)/(log((1/2)+(1/4)*pi*npo2))))^(((Df2012-1)/2)^m); %Nueva salida: exp. de solape
            % Número de partículas primarias
              incr_npo=0.00001;caso_npo=0;
              npolim_inf=5;
              npolim_sup=1000;
              npomat=npolim_inf:1:npolim_sup;
              npoc=0;Jfc=0;
              % Índice de coordinación J NUEVO
              A=1.85; B=0.0191; C=1.45; D=1.5; a=17; b=3.609; c=-0.3901; d=6.2;
              %J=2+D*(delta-1)*(Df-1)+(A+(B*(kf^b))+(C*(npo^c)))*10^(-8)*Df^(a+d*(delta-1));
            if (delta==1)
        npo2012=(npo2*(longitud_pixel^3)/((1/6*pi*dpo^3)));
        Jf2012=2+(D*(delta-1)*(Df2012-1))+(A+(B*(kf2012^b))+(C*(npo2012^c)))*10^(-8)*Df2012^(a+d*(delta-1));
    else
        for inpo=1:(size(npomat,2)-1)
        npoa=npomat(inpo);
        Jfa=2+(D*(delta-1)*(Df2012-1))+(A+(B*(kf2012^b))+(C*(npoa^c)))*10^(-8)*Df2012^(a+d*(delta-1));
        npo_funa = (npo2*(longitud_pixel^3)/((1/6*pi*dpo^3)*(1-(Jfa*((4*delta^3-6*delta^2+2)/(8*delta^3))))))-(exp((1/c)*log((Jfa-2-(D*(delta-1)*(Df2012-1))-A*10^(-8)*Df2012^(a+d*(delta-1))-B*(kf2012^b)*10^(-8)*Df2012^(a+d*(delta-1)))/(C*10^(-8)*Df2012^(a+d*(delta-1))))));
    
        npob=npomat(inpo+1); 
        Jfb=2+(D*(delta-1)*(Df2012-1))+(A+(B*(kf2012^b))+(C*(npob^c)))*10^(-8)*Df2012^(a+d*(delta-1));
        npo_funb = (npo2*(longitud_pixel^3)/((1/6*pi*dpo^3)*(1-(Jfb*((4*delta^3-6*delta^2+2)/(8*delta^3))))))-(exp((1/c)*log((Jfb-2-(D*(delta-1)*(Df2012-1))-A*10^(-8)*Df2012^(a+d*(delta-1))-B*(kf2012^b)*10^(-8)*Df2012^(a+d*(delta-1)))/(C*10^(-8)*Df2012^(a+d*(delta-1))))));
    if sign(npo_funa)~=sign(npo_funb)
        while abs(npoa-npob)>incr_npo
            npoc=(npoa+npob)/2;
            Jfc=2+(D*(delta-1)*(Df2012-1))+(A+(B*(kf2012^b))+(C*(npoc^c)))*10^(-8)*Df2012^(a+d*(delta-1));
            npo_func = (npo2*(longitud_pixel^3)/((1/6*pi*dpo^3)*(1-(Jfc*((4*delta^3-6*delta^2+2)/(8*delta^3))))))-(exp((1/c)*log((Jfc-2-(D*(delta-1)*(Df2012-1))-A*10^(-8)*Df2012^(a+d*(delta-1))-B*(kf2012^b)*10^(-8)*Df2012^(a+d*(delta-1)))/(C*10^(-8)*Df2012^(a+d*(delta-1))))));
            
            if sign(npo_funa)==sign(npo_func)
                npoa=npoc;npo_funa=npo_func;
            else
                npob=npoc;npo_funb=npo_func;
            end
        end
    end
    if npoc~=0 
        caso_npo=1;
        break;
    end
        end

if npoc==0 && caso_npo==0
    
    Jf= @(npo) 2+(D*(delta-1)*(Df2012-1))+(A+(B*(kf2012^b))+(C*(npo^c)))*10^(-8)*Df2012^(a+d*(delta-1));
    npo_fun= @(npo) abs((npo2*(longitud_pixel^3)/((1/6*pi*dpo^3)*(1-(Jf(npo)*((4*delta^3-6*delta^2+2)/(8*delta^3))))))-(exp((1/c)*log((Jf(npo)-2-(D*(delta-1)*(Df2012-1))-A*10^(-8)*Df2012^(a+d*(delta-1))-B*(kf2012^b)*10^(-8)*Df2012^(a+d*(delta-1)))/(C*10^(-8)*Df2012^(a+d*(delta-1)))))));
    npoc=fminbnd(npo_fun,npolim_inf,npolim_sup); 
    if npoc>(npolim_inf+0.001) && npoc<(npolim_sup-0.001)
        Jfc=2+(D*(delta-1)*(Df2012-1))+(A+(B*(kf2012^b))+(C*(npoc^c)))*10^(-8)*Df2012^(a+d*(delta-1));
    else
        npoc=0;
    end
end
npo2012=npoc;
Jf2012=Jfc;
            end
            vol2012=npo2012*((1/6*pi*dpo^3)*(1-(Jf2012*((4*delta^3-6*delta^2+2)/(8*delta^3))))); %Nueva salida: volumen aglomerado
            masa2012=1.85e-06*vol2012; %Nueva salida: masa aglomerado (densidad del hollín= 1.85e-06 fg/nm^3)
            Asup2012=npo2012*((pi*dpo^2)*(1-(Jf2012*((delta-1)/(2*delta))))); %Nueva salida: área superficial aglomerado    
            
    end
elseif npo2<npolim && npo2~=0
    fallo='npo<5';
end
end