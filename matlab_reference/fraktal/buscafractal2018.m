function [dfractal,npodf,kf,fun_aprox]=buscafractal2018(dp,nvox,Ap,m,escala,npix)
%funcion que encuentra la dimension fractal buscada utilizando vóxeles;
%encuentra una solucion, utiliza la menor de las soluciones;
incr=0.00001;dfc=0;kfc=0;caso=0;fun_aprox=0;
dfmat=1:0.05:3;
% Dimensión del vóxel
npix=(npix);
lvox=escala/npix;
% Cálculo del prefactor k
Akf= 1/(2*(((1/6)*((1/2)+(1/(nvox^2))))^(1/2)));
Bkf= nvox/(((2/3)*nvox)+(1/3));
Ckf= 1;
akf=Akf/2-Bkf+Ckf/2;bkf=-5/2*Akf+4*Bkf-3/2*Ckf;ckf=3*Akf-3*Bkf+Ckf;
% Cálculo del exp. de solape z
%z(Df=1)
Azp=log(nvox)/(log((1/2)+(1/4)*pi*nvox));
%z(Df=3)
Bzp=1.5;
for idf=1:(size(dfmat,2)-1)
    dfa=dfmat(idf);
    kfa=akf*dfa^2+bkf*dfa+ckf;
    zpa=Azp-1+(Bzp+1-Azp)^(((dfa-1)/2)^m);
    funa = kfa*(dp/lvox)^dfa-(Ap/(lvox^2))^zpa;
    
    dfb=dfmat(idf+1); 
    kfb=akf*dfb^2+bkf*dfb+ckf;
    zpb=Azp-1+(Bzp+1-Azp)^(((dfb-1)/2)^m);
    funb = kfb*(dp/lvox)^dfb-(Ap/(lvox^2))^zpb;
    
    if sign(funa)~=sign(funb)
        while abs(dfa-dfb)>incr
            dfc=(dfa+dfb)/2;
            kfc=akf*dfc^2+bkf*dfc+ckf;
            zpc=Azp-1+(Bzp+1-Azp)^(((dfc-1)/2)^m);
            func = kfc*(dp/lvox)^dfc-(Ap/(lvox^2))^zpc;
            
            if sign(funa)==sign(func)
                dfa=dfc;funa=func;
            else
                dfb=dfc;funb=func;
            end
        end
    end
    if dfc~=0 
        caso=1;
        break;
    end
end

if dfc==0 && caso==0
    
    kf= @(df) akf*df^2+bkf*df+ckf;
    zp= @(df) Azp-1+(Bzp+1-Azp)^(((df-1)/2)^m);
    fun= @(df) abs(kf(df)*(dp/lvox)^df-(Ap/(lvox^2))^zp(df));
    dfc=fminbnd(fun,1,3); 
    if dfc>1.001 && dfc<2.999
        kfc=akf*dfc^2+bkf*dfc+ckf;
        zpc=Azp-1+(Bzp+1-Azp)^(((dfc-1)/2)^m);
        fun_aprox = kfc*(dp/lvox)^dfc-(Ap/(lvox^2))^zpc;
    else
        dfc=0;
    end
end

% Número de vóxeles
npodf=kfc*(dp/lvox)^dfc;
% Resultados finales
dfractal=dfc;
kf=kfc;
end
