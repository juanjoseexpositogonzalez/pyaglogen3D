function c0j = calcularChoque( impactado, diamImpactante, v, impactante, delta )

% ----------------------------------------------------------------------------------------------------------------------
% c0j = calculatePositionOfCentre( part, diam_i, v, cP, particle )
% Determina la posicion del centro de una partícula que colisiona contra otra, si es que dicha
% colision existe
% 
% Argumentos de entrada:
% impactado:        Vector con las coordenadas x, y, z del monómero perteneciente al clúster impactado
% diamImpactante:   Diametro del monómero impactante.
% v:                Vector unitario que marca la trayectoria de colisión
% impactante:      	Vector con las coordenadas x, y, z del monómero perteneciente al clúster impactante
% delta:            Valor del aplastamiento o sintering
%
% Argumentos de salida:
% c0j:              Coordenadas x, y, z del monómero impactante una vez que ha colisionado contra el impactado
%
% ----------------------------------------------------------------------------------------------------------------------

%% Resuelve el problema de encontrar el centro de la nueva esfera del aglomerado
% Coeficientes de la ecuacion de segundo grado
if isempty( delta )
    delta = 1;
end

if iscell( impactado )
    impactado = cell2mat( impactado );    
end
impactado = impactado( :, 3 : 6 );
a = 1;
b = ( -2 ) * dot( impactante - impactado( 1, 1 : 3 ), v ) ;
c = norm( impactante - impactado( 1, 1 : 3 ) ) ^ 2  - ( ( impactado( 1, 4 ) + diamImpactante / 2 ) / delta ) ^ 2;
A = [ a b c ];
t = roots( A );
% Si las raices son reales hay impacto, si no se deja vacio.
if isreal( t )
    c0j = desplazarCoordenadas( impactante, -min( t ) * v );
else
    c0j = [];
end